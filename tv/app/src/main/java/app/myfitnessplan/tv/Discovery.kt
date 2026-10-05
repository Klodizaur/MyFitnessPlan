package app.myfitnessplan.tv

import android.content.Context
import android.net.ConnectivityManager
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Finds computers running MyFitnessPlan with Share on Local Network on, so the
 * TV can offer them instead of asking for an address.
 *
 * It asks every address on the TV's own network the same question Connect
 * asks — `GET /api/version` on the sharing port — and lists whoever answers
 * like MyFitnessPlan. Nothing extra has to run on the computer: sharing already
 * answers that. A home network is at most a few hundred addresses, which takes
 * a couple of seconds with short timeouts and many at once.
 */
object Discovery {
    data class Found(val baseUrl: String, val name: String)

    private const val CONNECT_TIMEOUT_MS = 500
    private const val READ_TIMEOUT_MS = 1200
    private const val PARALLEL = 48

    /**
     * The addresses to ask: the TV's own network, minus the TV. Networks wider
     * than a /24 are narrowed to the /24 around the TV — a home network with
     * the computer further away than that is not worth minutes of searching.
     */
    fun hostsToScan(ownIp: String, prefixLength: Int): List<String> {
        val parts = ownIp.split('.').mapNotNull { it.toIntOrNull() }
        if (parts.size != 4 || parts.any { it !in 0..255 }) return emptyList()
        val prefix = prefixLength.coerceIn(24, 30)
        val own = parts.fold(0L) { acc, p -> (acc shl 8) or p.toLong() }
        val mask = (0xFFFFFFFFL shl (32 - prefix)) and 0xFFFFFFFFL
        val network = own and mask
        val broadcast = network or (mask.inv() and 0xFFFFFFFFL)
        return (network + 1 until broadcast)
            .filter { it != own }
            .map { ip -> listOf(24, 16, 8, 0).joinToString(".") { ((ip shr it) and 0xFF).toString() } }
    }

    /** The TV's IPv4 address and network prefix, or null when it isn't on a network. */
    fun ownAddress(context: Context): Pair<String, Int>? {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val props = cm.getLinkProperties(cm.activeNetwork ?: return null) ?: return null
        val v4 = props.linkAddresses.firstOrNull { it.address is Inet4Address && !it.address.isLoopbackAddress }
            ?: return null
        return v4.address.hostAddress?.let { it to v4.prefixLength }
    }

    /**
     * Start looking. [onFound] is called on the main thread for each computer as
     * it answers, [onDone] once everything has been asked. Returns a handle to
     * stop early (leaving the setup screen).
     */
    fun scan(context: Context, port: Int, onFound: (Found) -> Unit, onDone: () -> Unit): () -> Unit {
        val main = Handler(Looper.getMainLooper())
        val own = ownAddress(context)
        val hosts = own?.let { hostsToScan(it.first, it.second) }.orEmpty()
        if (hosts.isEmpty()) {
            main.post(onDone)
            return {}
        }
        val pool: ExecutorService = Executors.newFixedThreadPool(PARALLEL)
        val left = AtomicInteger(hosts.size)
        // Its own flag: the pool reports "shut down" as soon as it stops taking
        // new work, which is right after everything has been queued.
        val stopped = AtomicBoolean(false)
        for (host in hosts) {
            pool.execute {
                if (stopped.get()) return@execute
                val base = "http://$host:$port"
                val name = ask(base)
                if (name != null && !stopped.get()) main.post { if (!stopped.get()) onFound(Found(base, name)) }
                if (left.decrementAndGet() == 0 && !stopped.get()) main.post(onDone)
            }
        }
        pool.shutdown()
        return {
            stopped.set(true)
            pool.shutdownNow()
        }
    }

    /** The computer's name if MyFitnessPlan answers at [base], else null. */
    private fun ask(base: String): String? {
        val conn = try {
            URL("$base/api/version").openConnection() as HttpURLConnection
        } catch (e: IOException) {
            return null
        }
        return try {
            conn.connectTimeout = CONNECT_TIMEOUT_MS
            conn.readTimeout = READ_TIMEOUT_MS
            if (conn.responseCode != 200) return null
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            if (!json.has("version")) return null
            // Older desktop versions don't send a name; the address stands in.
            json.optString("name").ifBlank { "MyFitnessPlan" }
        } catch (e: Exception) {
            null
        } finally {
            conn.disconnect()
        }
    }
}

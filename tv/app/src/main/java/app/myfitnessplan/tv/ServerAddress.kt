package app.myfitnessplan.tv

import java.net.URI
import java.net.URISyntaxException

/**
 * Turns whatever was typed with a remote into the server's base URL.
 *
 * The desktop tray shows `http://192.168.1.20:7777`, but typing on a TV is slow,
 * so the scheme and the Share on Local Network port may be left off. Kept free of
 * Android classes so it can be unit-tested on the JVM.
 */
object ServerAddress {
    /** Port the desktop app binds when Share on Local Network is on. */
    const val DEFAULT_PORT = 7777

    /** `http://host:port`, or null when the input can't be an address. */
    fun normalize(input: String): String? {
        val trimmed = numbersOnly(input.trim()) ?: input.trim()
        if (trimmed.isEmpty() || trimmed.any { it.isWhitespace() }) return null

        val withScheme = if ("://" in trimmed) trimmed else "http://$trimmed"
        val uri = try {
            URI(withScheme)
        } catch (e: URISyntaxException) {
            return null
        }

        val scheme = uri.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host ?: return null
        val port = if (uri.port == -1) {
            if (scheme == "http") DEFAULT_PORT else 443
        } else {
            uri.port
        }
        if (port !in 1..65535) return null

        // An IPv6 literal comes back from URI.host already in brackets.
        return "$scheme://$host:$port"
    }

    /**
     * An address typed as bare numbers with any separator — "192 168 1 20",
     * "192,168,1,20" — since a TV keyboard can make the dot hard to reach.
     * Four groups are the address, a fifth is the port. Null for anything else.
     */
    private fun numbersOnly(input: String): String? {
        if (!input.matches(Regex("[0-9 .,:;_-]+"))) return null
        val groups = input.split(Regex("[^0-9]+")).filter { it.isNotEmpty() }
        return when (groups.size) {
            4 -> groups.joinToString(".")
            5 -> groups.take(4).joinToString(".") + ":" + groups[4]
            else -> null
        }
    }

    /** The address as a person would type it: no `http://`. */
    fun display(baseUrl: String): String = baseUrl.removePrefix("http://")

    /** Same scheme, host and port: a page of the app rather than somewhere else. */
    fun isSameOrigin(baseUrl: String, url: String): Boolean {
        val base = try { URI(baseUrl) } catch (e: URISyntaxException) { return false }
        val other = try { URI(url) } catch (e: URISyntaxException) { return false }
        fun port(u: URI) = if (u.port != -1) u.port else if (u.scheme == "https") 443 else 80
        return base.scheme.equals(other.scheme, ignoreCase = true) &&
            base.host.equals(other.host, ignoreCase = true) &&
            port(base) == port(other)
    }
}

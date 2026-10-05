package app.myfitnessplan.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * The whole TV app: ask where the computer is once, then show its web interface.
 *
 * Everything the user sees after connecting is the existing web app served by
 * the computer; this shell only adds what a browser on a TV can't do by itself —
 * remembering the address, the remote's Back button, full-screen video, and
 * telling the page it is on a TV (the user-agent marker below).
 */
class MainActivity : Activity() {

    private lateinit var root: View
    private lateinit var web: WebView
    private lateinit var setup: View
    private lateinit var address: EditText
    private lateinit var setupError: TextView
    private lateinit var connect: Button
    private lateinit var offline: View
    private lateinit var offlineTitle: TextView
    private lateinit var offlineBody: TextView
    private lateinit var fullscreen: FrameLayout
    private lateinit var foundStatus: TextView
    private lateinit var foundList: LinearLayout
    private lateinit var searchAgain: Button

    /** Stops the search for computers on the network, while one is running. */
    private var stopSearch: (() -> Unit)? = null

    private val prefs by lazy { getSharedPreferences("server", Context.MODE_PRIVATE) }
    private val main = Handler(Looper.getMainLooper())

    private var baseUrl: String?
        get() = prefs.getString(KEY_BASE_URL, null)
        set(value) { prefs.edit().putString(KEY_BASE_URL, value).apply() }

    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        root = findViewById(R.id.root)
        web = findViewById(R.id.web)
        setup = findViewById(R.id.setup)
        address = findViewById(R.id.address)
        setupError = findViewById(R.id.setup_error)
        connect = findViewById(R.id.connect)
        offline = findViewById(R.id.offline)
        offlineTitle = findViewById(R.id.offline_title)
        offlineBody = findViewById(R.id.offline_body)
        fullscreen = findViewById(R.id.fullscreen)
        foundStatus = findViewById(R.id.found_status)
        foundList = findViewById(R.id.found_list)
        searchAgain = findViewById(R.id.search_again)
        searchAgain.setOnClickListener { startSearch() }

        configureWebView()

        connect.setOnClickListener { tryConnect() }
        address.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) { tryConnect(); true } else false
        }
        findViewById<Button>(R.id.retry).setOnClickListener { showApp() }
        findViewById<Button>(R.id.change).setOnClickListener { showSetup() }

        if (baseUrl == null) showSetup() else showApp()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        // TV sticks (Fire TV among them) draw video on a surface *behind* the
        // WebView and leave a see-through hole in the page for it. The WebView's
        // own default background is opaque white, which fills that hole: the
        // controls show, the sound plays, and the picture is white. The page
        // paints its own backgrounds, so the view itself can be transparent.
        web.setBackgroundColor(Color.TRANSPARENT)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // Nobody is going to tap the screen to start a video.
            mediaPlaybackRequiresUserGesture = false
            // The web interface switches TV mode on only when it sees this.
            userAgentString = "$userAgentString $USER_AGENT_MARKER/${BuildConfig.VERSION_NAME}"
        }

        // The page's side of the remote: see client/src/tv/index.ts and lib/tv.ts.
        web.addJavascriptInterface(ShellBridge(), "MfpTvShell")

        web.webViewClient = object : WebViewClient() {
            // The app's own pages stay here; anything else (a link out to a
            // website) is dropped rather than turning the TV app into a browser.
            // Frames such as the YouTube player aren't routed through this.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.isForMainFrame && !isAppUrl(request.url.toString())

            @Deprecated("Called instead of the request variant before Android 7")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = !isAppUrl(url)

            override fun onPageFinished(view: WebView, url: String) {
                if (isAppUrl(url)) checkTvMode(0)
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                // Only the page itself failing means the computer is gone; a
                // missing thumbnail or a blocked font is the page's business.
                if (request.isForMainFrame) showOffline()
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (customView != null) { callback.onCustomViewHidden(); return }
                customView = view
                customViewCallback = callback
                fullscreen.addView(view, FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
                fullscreen.visibility = View.VISIBLE
            }

            override fun onHideCustomView() {
                fullscreen.removeAllViews()
                fullscreen.visibility = View.GONE
                customView = null
                customViewCallback = null
                web.requestFocus()
            }
        }
    }

    private fun isAppUrl(url: String): Boolean =
        baseUrl?.let { ServerAddress.isSameOrigin(it, url) } ?: false

    // --- Screens ---------------------------------------------------------------

    private fun showApp() {
        val base = baseUrl ?: return showSetup()
        endSearch()
        setup.visibility = View.GONE
        offline.visibility = View.GONE
        web.visibility = View.VISIBLE
        web.loadUrl("$base/")
        web.requestFocus()
    }

    private fun showSetup() {
        root.setBackgroundResource(R.color.page)
        web.visibility = View.GONE
        offline.visibility = View.GONE
        setup.visibility = View.VISIBLE
        setupError.visibility = View.GONE
        setConnecting(false)
        address.setText(baseUrl?.let(ServerAddress::display) ?: "")
        address.setSelection(address.text.length)
        address.requestFocus()
        startSearch()
    }

    // --- Finding the computer --------------------------------------------------------

    private fun startSearch() {
        endSearch()
        foundList.removeAllViews()
        foundStatus.setText(R.string.setup_searching)
        searchAgain.visibility = View.GONE
        stopSearch = Discovery.scan(this, ServerAddress.DEFAULT_PORT, ::addFound) {
            stopSearch = null
            foundStatus.setText(if (foundList.childCount == 0) R.string.setup_none_found else R.string.setup_found)
            searchAgain.visibility = View.VISIBLE
        }
    }

    private fun endSearch() {
        stopSearch?.invoke()
        stopSearch = null
    }

    private fun addFound(found: Discovery.Found) {
        if (setup.visibility != View.VISIBLE) return
        val button = Button(this, null, 0, R.style.TvButton).apply {
            text = getString(R.string.setup_found_item, found.name, ServerAddress.display(found.baseUrl))
            setOnClickListener { connectTo(found.baseUrl) }
        }
        foundList.addView(button, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = (8 * resources.displayMetrics.density).toInt() })
        foundStatus.setText(R.string.setup_found)
        // The first computer found takes focus from an empty address box, so
        // OK connects straight away; someone already typing keeps their place.
        if (foundList.childCount == 1 && address.hasFocus() && address.text.isEmpty()) button.requestFocus()
    }

    private fun showOffline() = showProblem(R.string.error_title, R.string.error_body)

    /**
     * The computer answered, but with a MyFitnessPlan from before the TV app:
     * its pages have no TV mode, so the remote couldn't get around them.
     */
    private fun showOutdated() = showProblem(R.string.outdated_title, R.string.outdated_body)

    private fun showProblem(title: Int, body: Int) {
        val base = baseUrl ?: return showSetup()
        endSearch()
        web.stopLoading()
        root.setBackgroundResource(R.color.page)
        web.visibility = View.GONE
        setup.visibility = View.GONE
        offline.visibility = View.VISIBLE
        offlineTitle.setText(title)
        offlineBody.text = getString(body, ServerAddress.display(base))
        findViewById<Button>(R.id.retry).requestFocus()
    }

    /**
     * TV mode loads a moment after the page (client/src/main.tsx) and then
     * answers as `window.mfpTv`. Ask for a few seconds; a page that never
     * answers comes from a desktop version without TV support.
     */
    private fun checkTvMode(attempt: Int) {
        if (web.visibility != View.VISIBLE) return
        web.evaluateJavascript("typeof window.mfpTv") { type ->
            if (type == "\"object\"" || web.visibility != View.VISIBLE) return@evaluateJavascript
            if (attempt < TV_MODE_CHECKS) main.postDelayed({ checkTvMode(attempt + 1) }, 500)
            else showOutdated()
        }
    }

    // --- Connecting --------------------------------------------------------------

    private fun tryConnect() {
        val base = ServerAddress.normalize(address.text.toString())
        if (base == null) {
            showSetupError(getString(R.string.setup_invalid))
            return
        }
        connectTo(base)
    }

    /** Check that MyFitnessPlan answers at [base], then remember it and open it. */
    private fun connectTo(base: String) {
        setConnecting(true)
        setupError.visibility = View.GONE
        Thread {
            val result = probe(base)
            main.post {
                if (isFinishing || isDestroyed) return@post
                setConnecting(false)
                when (result) {
                    Probe.OK -> {
                        // A different computer means a different app: don't let
                        // Back walk into the old one's pages.
                        if (base != baseUrl) web.clearHistory()
                        baseUrl = base
                        showApp()
                    }
                    Probe.NOT_APP -> showSetupError(getString(R.string.setup_not_app, ServerAddress.display(base)))
                    Probe.UNREACHABLE -> showSetupError(getString(R.string.setup_unreachable, ServerAddress.display(base)))
                }
            }
        }.start()
    }

    private enum class Probe { OK, NOT_APP, UNREACHABLE }

    /** Ask the server for its version: only MyFitnessPlan answers that way. */
    private fun probe(base: String): Probe {
        val conn = try {
            URL("$base/api/version").openConnection() as HttpURLConnection
        } catch (e: IOException) {
            return Probe.UNREACHABLE
        }
        return try {
            conn.connectTimeout = PROBE_TIMEOUT_MS
            conn.readTimeout = PROBE_TIMEOUT_MS
            if (conn.responseCode != 200) return Probe.NOT_APP
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            if ("\"version\"" in body) Probe.OK else Probe.NOT_APP
        } catch (e: IOException) {
            Probe.UNREACHABLE
        } finally {
            conn.disconnect()
        }
    }

    private fun setConnecting(connecting: Boolean) {
        connect.isEnabled = !connecting
        address.isEnabled = !connecting
        connect.setText(if (connecting) R.string.setup_connecting else R.string.setup_connect)
    }

    private fun showSetupError(message: String) {
        setupError.text = message
        setupError.visibility = View.VISIBLE
        address.requestFocus()
    }

    // --- The remote -------------------------------------------------------------

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        if (code == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) handleBack()
            return true
        }
        // Media buttons go to the page as the key names a keyboard's media keys
        // have; the player listens for them. Only while the app is showing.
        val name = MEDIA_KEYS[code]
        if (name != null && web.visibility == View.VISIBLE && customView == null) {
            if (event.action == KeyEvent.ACTION_DOWN) {
                web.evaluateJavascript("window.mfpTv && window.mfpTv.key('$name')", null)
            }
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun handleBack() {
        when {
            customView != null -> customViewCallback?.onCustomViewHidden()
            // Came here from "Change address": Back returns to the app unchanged.
            setup.visibility == View.VISIBLE && baseUrl != null -> showApp()
            web.visibility == View.VISIBLE -> askPageToGoBack()
            else -> finish()
        }
    }

    /**
     * The page decides first: it closes an open dialog, or steps back a screen.
     * It answers false only on Home with nothing open, which means "leave".
     * A page without TV mode (an older server) falls back to browser history.
     */
    private fun askPageToGoBack() {
        web.evaluateJavascript("window.mfpTv ? String(window.mfpTv.back()) : 'none'") { result ->
            when (result) {
                "\"true\"" -> Unit
                "\"false\"" -> confirmExit()
                else -> if (web.canGoBack()) web.goBack() else confirmExit()
            }
        }
    }

    /**
     * What the page can ask of the TV app. Kept to harmless, narrow calls:
     * every frame on the page (the YouTube player included) can reach it.
     */
    private inner class ShellBridge {
        /** Lets the player keep the TV awake during a workout, and only then. */
        @JavascriptInterface
        fun setKeepScreenOn(on: Boolean) {
            runOnUiThread {
                if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }

        /**
         * The player is open: clear what sits behind the page so the video
         * surface (drawn behind the app window) shows through the hole the page
         * leaves for it. Every other screen keeps its background.
         */
        @JavascriptInterface
        fun setVideoOpen(open: Boolean) {
            runOnUiThread {
                if (open) root.setBackgroundColor(Color.TRANSPARENT)
                else root.setBackgroundResource(R.color.page)
            }
        }

        /** Whether an app on this TV plays YouTube links (for embedding-blocked videos). */
        @JavascriptInterface
        fun canOpenYouTube(): Boolean =
            youTubeIntent("dQw4w9WgXcQ").resolveActivity(packageManager) != null

        /** Hand a video to the TV's YouTube app; Back on the remote returns here. */
        @JavascriptInterface
        fun openYouTube(videoId: String) {
            if (!YOUTUBE_ID.matches(videoId)) return
            runOnUiThread {
                try {
                    startActivity(youTubeIntent(videoId))
                } catch (e: ActivityNotFoundException) {
                    // Uninstalled since the page asked; the error screen stays up.
                }
            }
        }
    }

    private fun youTubeIntent(videoId: String) =
        Intent(Intent.ACTION_VIEW, Uri.parse("vnd.youtube:$videoId"))

    /** Back on the first page: leave, or point the app at another computer. */
    private fun confirmExit() {
        AlertDialog.Builder(this)
            .setTitle(R.string.exit_title)
            .setPositiveButton(R.string.exit_confirm) { _, _ -> finish() }
            .setNegativeButton(R.string.exit_cancel, null)
            .setNeutralButton(R.string.change_address) { _, _ -> showSetup() }
            .show()
    }

    // --- Lifecycle -----------------------------------------------------------------

    override fun onPause() {
        // Home on the remote shouldn't leave a workout video playing behind the
        // launcher. (A YouTube frame can't be reached from here; pausing the
        // WebView's timers stops it from advancing in the meantime.)
        web.evaluateJavascript("document.querySelectorAll('video').forEach(function (v) { v.pause(); });", null)
        web.onPause()
        web.pauseTimers()
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        web.resumeTimers()
        web.onResume()
    }

    override fun onDestroy() {
        endSearch()
        web.destroy()
        super.onDestroy()
    }

    companion object {
        private const val KEY_BASE_URL = "base_url"
        private const val PROBE_TIMEOUT_MS = 4000
        /** 16 × 0.5 s: TV mode must answer within 8 seconds of the page loading. */
        private const val TV_MODE_CHECKS = 16
        const val USER_AGENT_MARKER = "MyFitnessPlanTV"

        private val YOUTUBE_ID = Regex("^[A-Za-z0-9_-]{6,20}$")

        private val MEDIA_KEYS = mapOf(
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE to "MediaPlayPause",
            KeyEvent.KEYCODE_MEDIA_PLAY to "MediaPlay",
            KeyEvent.KEYCODE_MEDIA_PAUSE to "MediaPause",
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD to "MediaFastForward",
            KeyEvent.KEYCODE_MEDIA_REWIND to "MediaRewind",
            KeyEvent.KEYCODE_MEDIA_NEXT to "MediaTrackNext",
            KeyEvent.KEYCODE_MEDIA_PREVIOUS to "MediaTrackPrevious",
        )
    }
}

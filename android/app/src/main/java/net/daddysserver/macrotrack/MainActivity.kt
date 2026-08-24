package net.daddysserver.macrotrack

import android.Manifest
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File

class MainActivity : ComponentActivity() {
    companion object {
        private const val APP_ORIGIN = "https://macrodaddy.tail984e80.ts.net"
        private const val AUTHENTIK_HOST = "auth.tail984e80.ts.net"
        private const val UPDATE_PREFS = "native_updates"
        private const val UPDATE_DOWNLOAD_ID = "download_id"
        private const val UPDATE_APK_PATH = "updates/MacroDaddy-update.apk"
        private const val APK_MIME = "application/vnd.android.package-archive"
    }

    private lateinit var webView: WebView
    private lateinit var rootContainer: FrameLayout
    private val downloadManager by lazy { getSystemService(DownloadManager::class.java) }
    private var awaitingInstallPermission = false
    private var pendingWebPermission: PermissionRequest? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraOutputUri: Uri? = null

    private val cameraPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            pendingWebPermission?.let { request ->
                if (granted) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                else request.deny()
            }
            pendingWebPermission = null
        }

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val uris = if (result.resultCode != RESULT_OK) {
                null
            } else if (result.data?.data == null && result.data?.clipData == null && cameraOutputUri != null) {
                arrayOf(cameraOutputUri!!)
            } else {
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            }
            fileCallback?.onReceiveValue(uris)
            fileCallback = null
            cameraOutputUri = null
        }

    private val updateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
            val completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
            if (completedId == savedUpdateDownloadId()) installDownloadedUpdate(completedId)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Explicit rather than relying on Android 15+'s forced edge-to-edge for
        // targetSdk 35+: that only stops the OS from auto-fitting content below
        // the status bar, it does NOT make the window allowed to extend under a
        // punch-hole cutout in portrait (default cutout mode still avoids it,
        // inconsistently across OEMs). Without both lines together, Samsung's
        // One UI was observed reporting a top inset shorter than the real
        // cutout, so the WebView's manual padding below undershot it.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.attributes = window.attributes.apply {
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }

        ContextCompat.registerReceiver(
            this,
            updateReceiver,
            IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
            ContextCompat.RECEIVER_EXPORTED,
        )

        CookieManager.getInstance().setAcceptCookie(true)
        webView = WebView(this).apply {
            setBackgroundColor(android.graphics.Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = true
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            addJavascriptInterface(NativeBridge(), "MacroTrackAndroid")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url
                    val trustedHost = uri.host == Uri.parse(APP_ORIGIN).host || uri.host == AUTHENTIK_HOST
                    if (uri.scheme == "https" && trustedHost) return false
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                    return true
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    runOnUiThread { handleWebPermission(request) }
                }

                override fun onShowFileChooser(
                    webView: WebView,
                    callback: ValueCallback<Array<Uri>>,
                    params: FileChooserParams,
                ): Boolean {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = callback
                    launchFileChooser(params)
                    return true
                }
            }
            // WebView does not download attachment responses on its own. Hand
            // HTTPS downloads to the system handler (normally the browser or
            // package installer), which provides a visible, user-controlled
            // download flow without granting arbitrary file access here.
            setDownloadListener { url, _, _, _, _ ->
                val uri = runCatching { Uri.parse(url) }.getOrNull()
                if (uri?.scheme != "https") {
                    showUpdateError("MacroDaddy blocked an unsafe download link.")
                    return@setDownloadListener
                }
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                    .onFailure { showUpdateError("Android couldn't open that download.") }
            }
            loadUrl(APP_ORIGIN)
        }

        // Android 15+ draws apps edge-to-edge. Keep the web viewport inside
        // the real status/navigation regions so MacroTrack's fixed controls
        // retain the same geometry as its installed PWA.
        // Padding is applied to a FrameLayout wrapper, not the WebView itself:
        // WebView.setPadding() sets the value on the Java object correctly
        // (verified live: paddingTop read back exactly as computed) but
        // Chromium's compositor ignores it entirely — window.innerHeight still
        // reported the WebView's full unpadded height, so nothing moved on
        // screen. A ViewGroup's padding goes through ordinary Android layout
        // and genuinely shrinks the child's allocated bounds, which Chromium
        // cannot ignore. Don't "simplify" this back to padding the WebView.
        //
        // The inset is exactly bars.top with no extra buffer: that reproduces
        // the installed PWA's geometry, where Chrome starts the viewport at
        // the status bar bottom and the app's own CSS header padding provides
        // the visual gap. Any buffer added here is additive with that CSS and
        // pushes the header visibly too low.
        // The container's background is what paints the inset strips behind the
        // status and navigation bars, so the web app pushes its current theme
        // colour here via NativeBridge.setThemeColor (7 user-selectable themes,
        // so this can't be a static value in styles.xml). Black until the page
        // reports in, which matches the default theme.
        rootContainer = FrameLayout(this)
        rootContainer.setBackgroundColor(android.graphics.Color.BLACK)
        rootContainer.addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        ViewCompat.setOnApplyWindowInsetsListener(rootContainer) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(0, bars.top, 0, bars.bottom)
            insets
        }
        setContentView(rootContainer)
        ViewCompat.requestApplyInsets(rootContainer)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })
    }

    private fun handleWebPermission(request: PermissionRequest) {
        val trusted = request.origin.scheme == "https" && request.origin.host == Uri.parse(APP_ORIGIN).host
        val wantsCamera = request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
        if (!trusted || !wantsCamera) {
            request.deny()
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
        } else {
            pendingWebPermission?.deny()
            pendingWebPermission = request
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    private fun launchFileChooser(params: WebChromeClient.FileChooserParams) {
        val accepts = params.acceptTypes.filter { it.isNotBlank() }
        val content = Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = accepts.firstOrNull() ?: "*/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)
            if (accepts.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, accepts.toTypedArray())
        }

        val extraIntents = mutableListOf<Intent>()
        val acceptsImages = accepts.isEmpty() || accepts.any { it == "*/*" || it.startsWith("image/") }
        if (acceptsImages && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            val dir = File(cacheDir, "camera").apply { mkdirs() }
            val photo = File.createTempFile("macrotrack-", ".jpg", dir)
            cameraOutputUri = FileProvider.getUriForFile(this, "$packageName.files", photo)
            val camera = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, cameraOutputUri)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            if (camera.resolveActivity(packageManager) != null) extraIntents += camera
        }

        val chooser = Intent(Intent.ACTION_CHOOSER).apply {
            putExtra(Intent.EXTRA_INTENT, content)
            putExtra(Intent.EXTRA_TITLE, params.title ?: "Choose a file")
            putExtra(Intent.EXTRA_INITIAL_INTENTS, extraIntents.toTypedArray())
        }
        runCatching { fileChooserLauncher.launch(chooser) }.onFailure {
            fileCallback?.onReceiveValue(null)
            fileCallback = null
            cameraOutputUri = null
        }
    }

    private fun savedUpdateDownloadId(): Long =
        getSharedPreferences(UPDATE_PREFS, MODE_PRIVATE).getLong(UPDATE_DOWNLOAD_ID, -1L)

    private fun saveUpdateDownloadId(id: Long) {
        getSharedPreferences(UPDATE_PREFS, MODE_PRIVATE).edit().putLong(UPDATE_DOWNLOAD_ID, id).apply()
    }

    private fun startNativeUpdate(url: String) {
        val uri = runCatching { Uri.parse(url) }.getOrNull()
        if (uri?.scheme !in setOf("http", "https")) {
            showUpdateError("The update link is invalid.")
            return
        }
        val previousId = savedUpdateDownloadId()
        if (previousId >= 0) downloadManager.remove(previousId)
        File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), UPDATE_APK_PATH).delete()

        val request = DownloadManager.Request(uri)
            .setTitle("MacroDaddy update")
            .setDescription("Downloading the latest app version")
            .setMimeType(APK_MIME)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, UPDATE_APK_PATH)
        val id = runCatching { downloadManager.enqueue(request) }.getOrElse {
            showUpdateError("The update couldn't start. Check your connection and try again.")
            return
        }
        saveUpdateDownloadId(id)
        android.widget.Toast.makeText(this, "Downloading MacroDaddy update…", android.widget.Toast.LENGTH_LONG).show()
    }

    private fun installDownloadedUpdate(id: Long) {
        val status = downloadManager.query(DownloadManager.Query().setFilterById(id)).use { cursor ->
            if (!cursor.moveToFirst()) return
            cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
        }
        if (status == DownloadManager.STATUS_FAILED) {
            saveUpdateDownloadId(-1L)
            showUpdateError("The update download failed. Please try again.")
            return
        }
        if (status != DownloadManager.STATUS_SUCCESSFUL) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
            awaitingInstallPermission = true
            startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                data = Uri.parse("package:$packageName")
            })
            return
        }
        val apkUri = downloadManager.getUriForDownloadedFile(id) ?: run {
            showUpdateError("Android couldn't open the downloaded update.")
            return
        }
        saveUpdateDownloadId(-1L)
        startActivity(Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(apkUri, APK_MIME)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        })
    }

    private fun showUpdateError(message: String) {
        AlertDialog.Builder(this)
            .setTitle("Update problem")
            .setMessage(message)
            .setPositiveButton("OK", null)
            .show()
    }

    override fun onResume() {
        super.onResume()
        if (awaitingInstallPermission && (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls())) {
            awaitingInstallPermission = false
            val id = savedUpdateDownloadId()
            if (id >= 0) installDownloadedUpdate(id)
        }
    }

    override fun onDestroy() {
        fileCallback?.onReceiveValue(null)
        pendingWebPermission?.deny()
        unregisterReceiver(updateReceiver)
        webView.destroy()
        super.onDestroy()
    }

    inner class NativeBridge {
        @JavascriptInterface fun getVersionName(): String = BuildConfig.VERSION_NAME
        @JavascriptInterface fun openUpdate(url: String) = runOnUiThread { startNativeUpdate(url) }
        @JavascriptInterface fun isNativeApp(): Boolean = true

        // Called by the web app whenever its theme changes (and on load), so the
        // status/navigation bar strips match the page instead of a fixed black.
        @JavascriptInterface
        fun setThemeColor(color: String) = runOnUiThread {
            val parsed = runCatching { android.graphics.Color.parseColor(color) }.getOrNull() ?: return@runOnUiThread
            rootContainer.setBackgroundColor(parsed)
            webView.setBackgroundColor(parsed)
        }
    }
}

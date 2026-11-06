package app.proxygram.client

import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Since Android 15 the app is drawn under the status and navigation bars, and the page does not know their size.
    // The web view keeps clear of them, of the display cutout and of the keyboard; the bars take the theme color.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
      WindowInsetsCompat.CONSUMED
    }
    // The navigation bar already has the theme color: no translucent scrim over it
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) window.isNavigationBarContrastEnforced = false
    val isNight = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    setBarsColor(if (isNight) DARK_BACKGROUND else Color.WHITE, isNight)
  }

  override fun onWebViewCreate(webView: WebView) {
    // The page reports the color of its theme (`src/proxygram/androidSystemBars.ts`)
    webView.addJavascriptInterface(SystemBars(), "PxgSystemBars")
  }

  private fun setBarsColor(color: Int, isDark: Boolean) {
    val content = findViewById<View>(android.R.id.content)
    content.setBackgroundColor(color)
    WindowCompat.getInsetsController(window, content).apply {
      isAppearanceLightStatusBars = !isDark
      isAppearanceLightNavigationBars = !isDark
    }
  }

  private inner class SystemBars {
    @JavascriptInterface
    fun setColor(color: String, isDark: Boolean) {
      val parsed = runCatching { Color.parseColor(color) }.getOrNull() ?: return
      runOnUiThread { setBarsColor(parsed, isDark) }
    }
  }

  private companion object {
    /** Web A dark theme background until the page reports its own */
    val DARK_BACKGROUND = Color.parseColor("#212121")
  }
}

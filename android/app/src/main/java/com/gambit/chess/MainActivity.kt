package com.gambit.chess

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat

/**
 * Гамбит — шахматный помощник.
 *
 * Вся логика приложения лежит в assets/www (тот же код, что и веб-версия),
 * поэтому обновлять интерфейс можно без пересборки нативных классов.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        webView = WebView(this)
        setContentView(webView)

        webView.setBackgroundColor(0xFF0E1015.toInt())
        webView.isVerticalScrollBarEnabled = false
        webView.isHorizontalScrollBarEnabled = false
        webView.overScrollMode = View.OVER_SCROLL_NEVER

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setGeolocationEnabled(false)
            mediaPlaybackRequiresUserGesture = true
            cacheMode = WebSettings.LOAD_DEFAULT
            textZoom = 100
            // тёмная тема и отключение автоувеличения шрифтов интерфейса
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                // внешние ссылки открываем в браузере, внутри приложения — нет
                return true
            }

            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = null
        }

        webView.loadUrl("file:///android_asset/www/index.html")
    }

    override fun onBackPressed() {
        // Назад: если есть история в приложении — отдаём ей, иначе закрываем.
        webView.evaluateJavascript(
            "window.gambitCanGoBack && window.gambitCanGoBack()"
        ) { result ->
            if (result == "true") {
                webView.evaluateJavascript("window.gambitGoBack && window.gambitGoBack()", null)
            } else {
                finish()
            }
        }
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }
}

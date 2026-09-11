package cn.sprwli.h2schedule;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // 关掉系统默认的蓝色焦点框（CSS 管不了这块）
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WebView webView = getBridge() != null ? getBridge().getWebView() : null;
      if (webView != null) {
        webView.setDefaultFocusHighlightEnabled(false);
      }
    }
  }

  @Override
  public void onStart() {
    super.onStart();
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WebView webView = getBridge() != null ? getBridge().getWebView() : null;
      if (webView != null) {
        webView.setDefaultFocusHighlightEnabled(false);
      }
    }
  }
}

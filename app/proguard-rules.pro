# 云五笔·玻璃键盘 R8/ProGuard 规则

# 保留输入法服务、引导页与整个应用包（包体小，重点是去调试信息与压缩）
-keep class com.cloudwubi.glasskeyboard.** { *; }

# 保留 WebView JavascriptInterface 桥方法（@JavascriptInterface）
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# 保留输入法/Activity 基类
-keep class * extends android.inputmethodservice.InputMethodService
-keep class * extends android.app.Activity

# WebView JS 回调安全：保留 KB 回调相关（属性名 R8 不混淆，双保险）
-keepclassmembers class com.cloudwubi.glasskeyboard.** {
    public *;
}

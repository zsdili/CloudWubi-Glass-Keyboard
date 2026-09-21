package com.cloudwubi.glasskeyboard;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.opengl.GLES20;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.ExtractedText;
import android.view.inputmethod.ExtractedTextRequest;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.inputmethodservice.InputMethodService;
import android.widget.LinearLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.ArrayList;

public class GlassImeService extends InputMethodService {

    private WebView web;
    private LinearLayout rootView;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private boolean listening = false;
    private float density = 2.0f;
    private final java.util.List<android.content.ComponentName> engineQueue = new ArrayList<>();
    private int engineIdx = 0;
    private Runnable readyWatchdog;
    private boolean softwareGpu = false;
    private android.content.SharedPreferences prefs() {
        return getSharedPreferences("cw", Context.MODE_PRIVATE);
    }

    /* 检测宿主是否软件 GPU（SwiftShader/模拟器）：软件合成下 backdrop-filter 会让 WebView 输出透明 */
    private boolean isSoftwareGpu() {
        javax.microedition.khronos.egl.EGL10 egl = (javax.microedition.khronos.egl.EGL10)
                javax.microedition.khronos.egl.EGLContext.getEGL();
        if (egl == null) return false;
        javax.microedition.khronos.egl.EGLDisplay dpy =
                egl.eglGetDisplay(javax.microedition.khronos.egl.EGL10.EGL_DEFAULT_DISPLAY);
        if (dpy == javax.microedition.khronos.egl.EGL10.EGL_NO_DISPLAY) return false;
        if (!egl.eglInitialize(dpy, new int[2])) return false;
        int[] n = new int[1];
        int[] cfgAttr = {
            0x3040, 0x4,                       /* EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT */
            javax.microedition.khronos.egl.EGL10.EGL_RED_SIZE, 8,
            javax.microedition.khronos.egl.EGL10.EGL_GREEN_SIZE, 8,
            javax.microedition.khronos.egl.EGL10.EGL_BLUE_SIZE, 8,
            javax.microedition.khronos.egl.EGL10.EGL_ALPHA_SIZE, 0,
            javax.microedition.khronos.egl.EGL10.EGL_DEPTH_SIZE, 0,
            javax.microedition.khronos.egl.EGL10.EGL_NONE
        };
        javax.microedition.khronos.egl.EGLConfig[] cfgs =
                new javax.microedition.khronos.egl.EGLConfig[1];
        if (!(egl.eglChooseConfig(dpy, cfgAttr, cfgs, 1, n) && n[0] > 0)) {
            egl.eglTerminate(dpy); return false;
        }
        int[] ctxAttr = { 0x3098 /*EGL_CONTEXT_CLIENT_VERSION*/, 2,
                javax.microedition.khronos.egl.EGL10.EGL_NONE };
        javax.microedition.khronos.egl.EGLContext ctx = egl.eglCreateContext(
                dpy, cfgs[0], javax.microedition.khronos.egl.EGL10.EGL_NO_CONTEXT, ctxAttr);
        if (ctx == javax.microedition.khronos.egl.EGL10.EGL_NO_CONTEXT) {
            egl.eglTerminate(dpy); return false;
        }
        int[] surfAttr = {
            javax.microedition.khronos.egl.EGL10.EGL_WIDTH, 1,
            javax.microedition.khronos.egl.EGL10.EGL_HEIGHT, 1,
            javax.microedition.khronos.egl.EGL10.EGL_NONE
        };
        javax.microedition.khronos.egl.EGLSurface surf =
                egl.eglCreatePbufferSurface(dpy, cfgs[0], surfAttr);
        String renderer = null;
        if (surf != null && surf != javax.microedition.khronos.egl.EGL10.EGL_NO_SURFACE
                && egl.eglMakeCurrent(dpy, surf, surf, ctx)) {
            try { renderer = GLES20.glGetString(GLES20.GL_RENDERER); } catch (Exception ignored) {}
        }
        try {
            egl.eglMakeCurrent(dpy, javax.microedition.khronos.egl.EGL10.EGL_NO_SURFACE,
                    javax.microedition.khronos.egl.EGL10.EGL_NO_SURFACE,
                    javax.microedition.khronos.egl.EGL10.EGL_NO_CONTEXT);
        } catch (Exception ignored) {}
        try { if (surf != null) egl.eglDestroySurface(dpy, surf); } catch (Exception ignored) {}
        try { egl.eglDestroyContext(dpy, ctx); } catch (Exception ignored) {}
        try { egl.eglTerminate(dpy); } catch (Exception ignored) {}
        boolean sw = false;
        if (renderer != null) {
            String r = renderer.toLowerCase();
            sw = r.contains("swiftshader") || r.contains("llvmpipe")
                    || r.contains("emulator") || r.contains("android x86");
        }
        Log.i("CloudWubi", "GL_RENDERER=" + renderer + " softwareGpu=" + sw);
        return sw;
    }

    @Override
    public View onCreateInputView() {
        density = getResources().getDisplayMetrics().density;
        softwareGpu = isSoftwareGpu();
        getWindow().getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));

        rootView = new LinearLayout(this);
        rootView.setOrientation(LinearLayout.VERTICAL);
        rootView.setBackgroundColor(Color.TRANSPARENT);
        rootView.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.setFocusable(false);
        web.setFocusableInTouchMode(false);
        web.setClickable(true);
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, (int) (340 * density));
        web.setLayoutParams(lp);
        rootView.addView(web);
        web.loadUrl("file:///android_asset/web/index.html");
        return rootView;
    }

    private void js(final String call) {
        ui.post(new Runnable() {
            @Override public void run() {
                if (web != null) web.evaluateJavascript(call, null);
            }
        });
    }

    @Override
    public void onStartInput(EditorInfo attribute, boolean restarting) {
        super.onStartInput(attribute, restarting);
        int it = attribute.inputType;
        int cls = it & InputType.TYPE_MASK_CLASS;
        int variation = it & InputType.TYPE_MASK_VARIATION;
        boolean pwd = variation == InputType.TYPE_TEXT_VARIATION_PASSWORD
                || variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                || variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD;
        boolean numPwd = cls == InputType.TYPE_CLASS_NUMBER
                && variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD;
        boolean numeric = cls == InputType.TYPE_CLASS_NUMBER;
        js("if(window.KB&&KB.onStartInput)KB.onStartInput(" + pwd + "," + numPwd + "," + numeric + ");");
    }

    @Override
    public void onWindowShown() {
        super.onWindowShown();
        // 键盘每次从隐藏变为显示都恢复默认（用户固化需求）
        js("if(window.KB&&KB.onWindowShown)KB.onWindowShown();");
    }

    @Override
    public void onUpdateSelection(int oldSelStart, int oldSelEnd, int newSelStart, int newSelEnd,
                                  int candidatesStart, int candidatesEnd) {
        super.onUpdateSelection(oldSelStart, oldSelEnd, newSelStart, newSelEnd, candidatesStart, candidatesEnd);
        js("if(window.KB&&KB.onSelection)KB.onSelection();");
    }

    @Override
    public void onDestroy() {
        destroyRecognizer();
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    private void destroyRecognizer() {
        cancelReadyWatchdog();
        if (recognizer != null) {
            try { recognizer.cancel(); recognizer.destroy(); } catch (Exception ignored) {}
            recognizer = null;
        }
        listening = false;
    }

    private boolean hasMicPermission() {
        if (Build.VERSION.SDK_INT >= 23) {
            return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    /** 一个识别引擎：组件 + 友好名 + 评分 */
    private static final class EngineInfo {
        final android.content.ComponentName c; final String l; final int score;
        EngineInfo(android.content.ComponentName c, String l, int score) { this.c = c; this.l = l; this.score = score; }
    }
    private boolean zhLocale() {
        String lang = java.util.Locale.getDefault().getLanguage();
        return lang != null && lang.startsWith("zh");
    }
    private String engineLabel(String pkg) {
        if (pkg.contains("vivo") || pkg.contains("jovi") || pkg.contains("xiaowei")) return "vivo Jovi 语音";
        if (pkg.contains("iflytek") || pkg.contains("ifly")) return "讯飞语音";
        if (pkg.contains("baidu")) return "百度语音";
        if (pkg.contains("google")) return "Google 语音";
        if (pkg.contains("huawei") || pkg.contains("honor")) return "华为/荣耀语音";
        if (pkg.contains("xiaomi") || pkg.contains("miui")) return "小米语音";
        if (pkg.contains("oppo") || pkg.contains("coloros")) return "OPPO 语音";
        return pkg;
    }
    /* 中文环境（国行 ROM）国内/厂商引擎在前、Google 降级；海外反之 */
    private int engineScore(String pkg) {
        boolean zh = zhLocale();
        if (pkg.contains("googlequicksearchbox") || pkg.contains("google")) return zh ? 45 : 95;
        if (pkg.contains("vivo") || pkg.contains("jovi") || pkg.contains("xiaowei")) return zh ? 95 : 60;
        if (pkg.contains("iflytek") || pkg.contains("ifly")) return zh ? 92 : 80;
        if (pkg.contains("baidu")) return zh ? 88 : 70;
        if (pkg.contains("huawei") || pkg.contains("honor") || pkg.contains("xiaomi") || pkg.contains("miui")
                || pkg.contains("oppo") || pkg.contains("coloros")) return zh ? 70 : 55;
        return 30;
    }
    /** 枚举全部标准 RecognitionService，去重、按评分降序 */
    private java.util.List<EngineInfo> enumerateEngines() {
        java.util.List<EngineInfo> out = new ArrayList<>();
        try {
            android.content.Intent qi = new android.content.Intent("android.speech.RecognitionService");
            java.util.List<android.content.pm.ResolveInfo> list = getPackageManager().queryIntentServices(qi, 0);
            java.util.Set<String> seen = new java.util.HashSet<>();
            for (android.content.pm.ResolveInfo ri : list) {
                android.content.pm.ServiceInfo si = ri.serviceInfo;
                if (si == null || si.packageName == null || si.name == null) continue;
                android.content.ComponentName cn = new android.content.ComponentName(si.packageName, si.name);
                if (!seen.add(cn.flattenToShortString())) continue;
                String pkg = si.packageName;
                out.add(new EngineInfo(cn, engineLabel(pkg), engineScore(pkg)));
            }
            java.util.Collections.sort(out, new java.util.Comparator<EngineInfo>() {
                @Override public int compare(EngineInfo a, EngineInfo b) { return b.score - a.score; }
            });
        } catch (Exception e) {
            android.util.Log.w("CloudWubiVoice", "枚举识别服务失败: " + e);
        }
        StringBuilder dbg = new StringBuilder();
        for (EngineInfo e : out) dbg.append(e.l).append("(").append(e.score).append(") ");
        android.util.Log.i("CloudWubiVoice", "枚举识别服务: " + dbg);
        return out;
    }

    /** 语音入口：系统 SpeechRecognizer（真机自带引擎、零体积、免费）；云端语音作为在线兜底。 */
    private void startVoice() {
        if (!hasMicPermission()) { js("KB.voiceError('mic-permission');"); return; }
        startSystemVoice();
    }

    private void startSystemVoice() {
        if (!hasMicPermission()) { js("KB.voiceError('mic-permission');"); return; }
        // 队列：手动指定引擎优先，其余按评分作为 fallback（去重）
        java.util.List<EngineInfo> all = enumerateEngines();
        engineQueue.clear();
        java.util.Set<String> have = new java.util.HashSet<>();
        String manual = prefs().getString("engine", "");
        if (manual != null && !manual.isEmpty()) {
            try {
                android.content.ComponentName mc = android.content.ComponentName.unflattenFromString(manual);
                if (mc != null) { engineQueue.add(mc); have.add(mc.flattenToShortString()); }
            } catch (Exception ignored) {}
        }
        for (EngineInfo e : all) {
            String k = e.c.flattenToShortString();
            if (have.add(k)) engineQueue.add(e.c);
        }
        boolean avail = false;
        try { avail = SpeechRecognizer.isRecognitionAvailable(this); } catch (Exception ignored) {}
        if (engineQueue.isEmpty() && !avail) { js("KB.voiceError('unavailable');"); return; }
        if (engineQueue.isEmpty()) engineQueue.add(null);  // 无枚举服务但系统声明可用 → 系统默认
        engineIdx = 0;
        beginEngine();
    }

    private void cancelReadyWatchdog() {
        if (readyWatchdog != null) { ui.removeCallbacks(readyWatchdog); readyWatchdog = null; }
    }

    /* 启动队列中当前引擎；失败由 nextEngine 自动切换 */
    private void beginEngine() {
        if (engineIdx >= engineQueue.size()) { js("KB.voiceError('unavailable');"); return; }
        destroyRecognizer();
        final android.content.ComponentName eng = engineQueue.get(engineIdx);
        try {
            if (eng != null) recognizer = SpeechRecognizer.createSpeechRecognizer(GlassImeService.this, eng);
            else recognizer = SpeechRecognizer.createSpeechRecognizer(GlassImeService.this);
        } catch (Exception e) {
            android.util.Log.w("CloudWubiVoice", "创建引擎失败 " + eng + " : " + e);
            nextEngine("createfail");
            return;
        }
        if (recognizer == null) { nextEngine("null"); return; }
        android.util.Log.i("CloudWubiVoice", "使用引擎[" + (engineIdx + 1) + "/" + engineQueue.size() + "]: "
                + (eng != null ? eng.flattenToShortString() : "系统默认"));
        recognizer.setRecognitionListener(buildListener());
        // ready 前 watchdog：5s 没起来就换下一个引擎
        readyWatchdog = new Runnable() {
            @Override public void run() {
                if (!listening) {
                    android.util.Log.w("CloudWubiVoice", "引擎 " + eng + " 5s 未 ready，切换");
                    nextEngine("noready");
                }
            }
        };
        ui.postDelayed(readyWatchdog, 5000);
        android.content.Intent intent = new android.content.Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "zh-CN");
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        try { recognizer.startListening(intent); }
        catch (Exception e) {
            android.util.Log.w("CloudWubiVoice", "startListening 异常 " + e);
            nextEngine("startfail");
        }
    }

    private void nextEngine(final String why) {
        cancelReadyWatchdog();
        engineIdx++;
        if (engineIdx >= engineQueue.size()) {
            android.util.Log.w("CloudWubiVoice", "全部引擎失败，末因 " + why);
            js("KB.voiceError('unavailable');");
            return;
        }
        android.util.Log.i("CloudWubiVoice", "引擎切换(" + why + ") → ["
                + (engineIdx + 1) + "/" + engineQueue.size() + "]");
        js("KB.voiceRetry(" + (engineIdx + 1) + "," + engineQueue.size() + ");");
        beginEngine();
    }

    private RecognitionListener buildListener() {
        return new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) {
                listening = true;
                cancelReadyWatchdog();
                android.util.Log.i("CloudWubiVoice", "onReadyForSpeech");
                js("KB.voiceState('ready');");
            }
            @Override public void onBeginningOfSpeech() {
                android.util.Log.i("CloudWubiVoice", "onBeginningOfSpeech");
                js("KB.voiceState('listening');");
            }
            @Override public void onRmsChanged(float rmsdB) {
                int v = Math.max(0, Math.min(100, (int) ((rmsdB + 2f) * 9f)));
                js("KB.voiceLevel(" + v + ");");
            }
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEndOfSpeech() { js("KB.voiceState('processing');"); }
            @Override public void onError(int error) {
                listening = false;
                android.util.Log.w("CloudWubiVoice", "onError code=" + error
                        + " idx=" + engineIdx + "/" + engineQueue.size());
                if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                    cancelReadyWatchdog();
                    js("KB.voiceError('mic-permission');");
                    return;
                }
                if (engineIdx + 1 < engineQueue.size()) { nextEngine("err" + error); }
                else { cancelReadyWatchdog(); js("KB.voiceError('" + error + "');"); }
            }
            @Override public void onResults(Bundle results) {
                listening = false;
                cancelReadyWatchdog();
                android.util.Log.i("CloudWubiVoice", "onResults");
                ArrayList<String> list = results != null
                        ? results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) : null;
                if (list != null && !list.isEmpty() && list.get(0) != null && !list.get(0).isEmpty()) {
                    js("KB.voiceResult(" + JSONObject.quote(list.get(0)) + ");");
                } else if (engineIdx + 1 < engineQueue.size()) { nextEngine("empty"); }
                else { js("KB.voiceError('empty');"); }
            }
            @Override public void onPartialResults(Bundle partialResults) {
                ArrayList<String> list = partialResults != null
                        ? partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) : null;
                if (list != null && !list.isEmpty()) js("KB.voicePartial(" + JSONObject.quote(list.get(0)) + ");");
            }
            @Override public void onEvent(int eventType, Bundle params) {}
        };
    }

    final class Bridge {

        @JavascriptInterface
        public void commit(final String text) {
            InputConnection ic = getCurrentInputConnection();
            if (ic != null) ic.commitText(text == null ? "" : text, 1);
        }

        @JavascriptInterface
        public void del() { del(1); }

        @JavascriptInterface
        public void selectAll() {
            InputConnection ic = getCurrentInputConnection();
            if (ic == null) return;
            ExtractedText et = ic.getExtractedText(new ExtractedTextRequest(), 0);
            if (et != null && et.text != null) ic.setSelection(0, et.text.length());
        }

        @JavascriptInterface
        public void del(final int n) {
            InputConnection ic = getCurrentInputConnection();
            if (ic == null) return;
            ic.finishComposingText();
            ExtractedText et = ic.getExtractedText(new ExtractedTextRequest(), 0);
            if (et != null && et.selectionStart != et.selectionEnd) {
                ic.commitText("", 1);   // 有选区（含全选）：删除选中内容
                return;
            }
            int count = Math.max(1, n);
            ic.deleteSurroundingText(count, 0);
        }

        @JavascriptInterface
        public void sendEnter() {
            InputConnection ic = getCurrentInputConnection();
            if (ic == null) return;
            ic.sendKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER));
            ic.sendKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER));
        }

        @JavascriptInterface
        public void cursor(final int dir) {
            InputConnection ic = getCurrentInputConnection();
            if (ic == null) return;
            int code = dir < 0 ? KeyEvent.KEYCODE_DPAD_LEFT : KeyEvent.KEYCODE_DPAD_RIGHT;
            ic.sendKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, code));
            ic.sendKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, code));
        }

        @JavascriptInterface
        public void updateHeight(final float cssPx) {
            ui.post(new Runnable() {
                @Override public void run() {
                    if (web == null) return;
                    ViewGroup.LayoutParams lp = web.getLayoutParams();
                    int h = Math.max((int) (160 * density), (int) (cssPx * density));
                    if (lp.height != h) {
                        lp.height = h;
                        web.setLayoutParams(lp);
                    }
                }
            });
        }

        @JavascriptInterface
        public void vibrate() { vibrate(18); }

        @JavascriptInterface
        public void vibrate(final int ms) {
            try {
                Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) {
                    android.util.Log.d("CloudWubiVib", "设备无振动器");
                    return;
                }
                int dur = ms <= 0 ? 25 : Math.min(ms, 80);
                android.util.Log.d("CloudWubiVib", "触发振动 dur=" + dur);
                if (Build.VERSION.SDK_INT >= 26) {
                    // 明确幅度（1-255），避免部分机型 DEFAULT_AMPLITUDE 过弱感知不到
                    v.vibrate(VibrationEffect.createOneShot(dur, 200));
                } else {
                    v.vibrate(dur);
                }
            } catch (Exception e) {
                android.util.Log.d("CloudWubiVib", "振动异常 " + e.getMessage());
            }
        }

        @JavascriptInterface
        public void hideKeyboard() {
            requestHideSelf(0);
        }

        @JavascriptInterface
        public boolean canVoice() {
            return hasMicPermission() && SpeechRecognizer.isRecognitionAvailable(GlassImeService.this);
        }

        @JavascriptInterface
        public boolean hasMic() {
            return hasMicPermission();
        }

        @JavascriptInterface
        public String engineList() {
            org.json.JSONArray arr = new org.json.JSONArray();
            try {
                java.util.List<EngineInfo> all = enumerateEngines();
                for (EngineInfo e : all) {
                    org.json.JSONObject o = new org.json.JSONObject();
                    o.put("c", e.c.flattenToShortString());
                    o.put("l", e.l);
                    arr.put(o);
                }
            } catch (Exception ignored) {}
            return arr.toString();
        }

        @JavascriptInterface
        public String getEngine() {
            return prefs().getString("engine", "");
        }

        @JavascriptInterface
        public void setEngine(final String c) {
            android.content.SharedPreferences.Editor ed = prefs().edit();
            ed.putString("engine", c == null ? "" : c);
            ed.apply();
        }

        @JavascriptInterface
        public boolean softGpu() { return softwareGpu; }

        @JavascriptInterface
        public void startVoice() {
            ui.post(new Runnable() { @Override public void run() { startVoice(); } });
        }

        @JavascriptInterface
        public void stopVoice() {
            ui.post(new Runnable() {
                @Override public void run() {
                    if (recognizer != null && listening) {
                        recognizer.stopListening();
                    }
                }
            });
        }

        @JavascriptInterface
        public void switchKeyboard() {
            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (imm != null) imm.showInputMethodPicker();
        }

        @JavascriptInterface
        public void openSetup() {
            ui.post(new Runnable() {
                @Override public void run() {
                    try {
                        android.content.Intent it = new android.content.Intent(GlassImeService.this, MainActivity.class);
                        it.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                        it.putExtra("mic", true);
                        startActivity(it);
                    } catch (Exception ignored) {}
                }
            });
        }

        @JavascriptInterface
        public String contextBefore(int n) {
            InputConnection ic = getCurrentInputConnection();
            if (ic == null) return "";
            try {
                CharSequence c = ic.getTextBeforeCursor(Math.max(1, Math.min(n, 120)), 0);
                return c == null ? "" : c.toString();
            } catch (Exception e) { return ""; }
        }

        @JavascriptInterface
        public String contextAfter(int n) {
            InputConnection ic = getCurrentInputConnection();
            if (ic == null) return "";
            try {
                CharSequence c = ic.getTextAfterCursor(Math.max(1, Math.min(n, 120)), 0);
                return c == null ? "" : c.toString();
            } catch (Exception e) { return ""; }
        }

        @JavascriptInterface
        public String clipRead() {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (cm != null && cm.hasPrimaryClip() && cm.getPrimaryClip() != null
                        && cm.getPrimaryClip().getItemCount() > 0) {
                    ClipData.Item it = cm.getPrimaryClip().getItemAt(0);
                    CharSequence t = it.coerceToText(GlassImeService.this);
                    return t == null ? "" : t.toString();
                }
            } catch (Exception ignored) {}
            return "";
        }

        @JavascriptInterface
        public String diagnostics() {
            try {
                org.json.JSONObject o = new org.json.JSONObject();
                o.put("app", "2.9-lite");
                o.put("model", Build.MANUFACTURER + " " + Build.MODEL);
                o.put("sdk", Build.VERSION.SDK_INT);
                o.put("rel", Build.VERSION.RELEASE);
                o.put("mic", checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED);
                boolean avail = false;
                try { avail = SpeechRecognizer.isRecognitionAvailable(GlassImeService.this); } catch (Exception ignored) {}
                o.put("voiceService", avail);
                o.put("manualEngine", prefs().getString("engine", ""));
                o.put("softGpu", softwareGpu);
                org.json.JSONArray engines = new org.json.JSONArray();
                try {
                    for (EngineInfo e : enumerateEngines()) {
                        org.json.JSONObject eo = new org.json.JSONObject();
                        eo.put("c", e.c.flattenToShortString());
                        eo.put("l", e.l);
                        eo.put("score", e.score);
                        engines.put(eo);
                    }
                } catch (Exception ignored) {}
                o.put("engines", engines);
                return o.toString();
            } catch (Exception e) { return "{\"error\":\"" + e.getMessage() + "\"}"; }
        }

        @JavascriptInterface
        public void copy(final String text) {            ui.post(new Runnable() {
                @Override public void run() {
                    try {
                        ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                        if (cm != null) {
                            cm.setPrimaryClip(ClipData.newPlainText("cloudwubi", text));
                            Toast.makeText(GlassImeService.this, "诊断信息已复制", Toast.LENGTH_SHORT).show();
                        }
                    } catch (Exception ignored) {}
                }
            });
        }

        @JavascriptInterface
        public void share(final String text) {
            ui.post(new Runnable() {
                @Override public void run() {
                    try {
                        android.content.Intent it = new android.content.Intent(android.content.Intent.ACTION_SEND);
                        it.setType("text/plain");
                        it.putExtra(android.content.Intent.EXTRA_TEXT, text);
                        it.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                        android.content.Intent chooser = android.content.Intent.createChooser(it, "反馈云五笔·玻璃键盘问题");
                        chooser.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(chooser);
                    } catch (Exception ignored) {}
                }
            });
        }
    }
}

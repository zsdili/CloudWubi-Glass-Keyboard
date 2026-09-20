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

    @Override
    public View onCreateInputView() {
        density = getResources().getDisplayMetrics().density;
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

    /** 枚举系统中所有标准 RecognitionService，按可信度挑选：Google > 讯飞 > 百度 > 厂商 > 其他 */
    private android.content.ComponentName pickRecognizer() {
        try {
            android.content.Intent qi = new android.content.Intent("android.speech.RecognitionService");
            java.util.List<android.content.pm.ResolveInfo> list = getPackageManager().queryIntentServices(qi, 0);
            android.content.ComponentName best = null;
            int bestScore = -1;
            StringBuilder dbg = new StringBuilder();
            for (android.content.pm.ResolveInfo ri : list) {
                android.content.pm.ServiceInfo si = ri.serviceInfo;
                String pkg = si.packageName == null ? "" : si.packageName;
                int score;
                if (pkg.contains("googlequicksearchbox")) score = 100;
                else if (pkg.contains("iflytek") || pkg.contains("ifly")) score = 85;
                else if (pkg.contains("baidu")) score = 75;
                else if (pkg.contains("vivo") || pkg.contains("jovi") || pkg.contains("xiaowei")) score = 65;
                else if (pkg.contains("huawei") || pkg.contains("xiaomi") || pkg.contains("oppo")) score = 50;
                else score = 20;
                dbg.append(pkg).append("/").append(si.name).append("(").append(score).append(") ");
                if (score > bestScore) { bestScore = score; best = new android.content.ComponentName(si.packageName, si.name); }
            }
            android.util.Log.i("CloudWubiVoice", "枚举识别服务: " + dbg.toString());
            return best;
        } catch (Exception e) {
            android.util.Log.w("CloudWubiVoice", "枚举识别服务失败: " + e);
            return null;
        }
    }

    private void startVoice() {
        if (!hasMicPermission()) {
            js("KB.voiceError('mic-permission');");
            return;
        }
        android.content.ComponentName engine = pickRecognizer();
        boolean avail = false;
        try { avail = SpeechRecognizer.isRecognitionAvailable(this); } catch (Exception ignored) {}
        if (engine == null && !avail) {
            js("KB.voiceError('unavailable');");
            return;
        }
        destroyRecognizer();
        try {
            if (engine != null) {
                recognizer = SpeechRecognizer.createSpeechRecognizer(GlassImeService.this, engine);
            } else {
                recognizer = SpeechRecognizer.createSpeechRecognizer(GlassImeService.this);
            }
            android.util.Log.i("CloudWubiVoice", "使用识别引擎: " + (engine != null ? engine.flattenToShortString() : "系统默认"));
        } catch (Exception e) {
            try { recognizer = SpeechRecognizer.createSpeechRecognizer(GlassImeService.this); }
            catch (Exception e2) { js("KB.voiceError('unavailable');"); return; }
        }
        if (recognizer == null) { js("KB.voiceError('unavailable');"); return; }
        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) {
                listening = true;
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
                android.util.Log.w("CloudWubiVoice", "onError code=" + error);
                js("KB.voiceError('" + error + "');");
            }
            @Override public void onResults(Bundle results) {
                listening = false;
                android.util.Log.i("CloudWubiVoice", "onResults");
                ArrayList<String> list = results != null
                        ? results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) : null;
                if (list != null && !list.isEmpty()) {
                    js("KB.voiceResult(" + JSONObject.quote(list.get(0)) + ");");
                } else {
                    js("KB.voiceError('empty');");
                }
            }
            @Override public void onPartialResults(Bundle partialResults) {
                ArrayList<String> list = partialResults != null
                        ? partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) : null;
                if (list != null && !list.isEmpty()) {
                    js("KB.voicePartial(" + JSONObject.quote(list.get(0)) + ");");
                }
            }
            @Override public void onEvent(int eventType, Bundle params) {}
        });
        android.content.Intent intent = new android.content.Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "zh-CN");
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        try {
            recognizer.startListening(intent);
        } catch (Exception e) {
            js("KB.voiceError('5');");
        }
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
        public void vibrate() { vibrate(14); }

        @JavascriptInterface
        public void vibrate(final int ms) {
            try {
                Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) return;
                int dur = ms <= 0 ? 14 : Math.min(ms, 60);
                if (Build.VERSION.SDK_INT >= 26) {
                    v.vibrate(VibrationEffect.createOneShot(dur, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(dur);
                }
            } catch (Exception ignored) {}
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
                o.put("app", "1.9-lite");
                o.put("model", Build.MANUFACTURER + " " + Build.MODEL);
                o.put("sdk", Build.VERSION.SDK_INT);
                o.put("rel", Build.VERSION.RELEASE);
                o.put("mic", checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED);
                boolean avail = false;
                try { avail = SpeechRecognizer.isRecognitionAvailable(GlassImeService.this); } catch (Exception ignored) {}
                o.put("voiceService", avail);
                org.json.JSONArray engines = new org.json.JSONArray();
                try {
                    android.content.Intent qi = new android.content.Intent("android.speech.RecognitionService");
                    java.util.List<android.content.pm.ResolveInfo> rl = getPackageManager().queryIntentServices(qi, 0);
                    for (android.content.pm.ResolveInfo ri : rl) {
                        engines.put(ri.serviceInfo.packageName + "/" + ri.serviceInfo.name);
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

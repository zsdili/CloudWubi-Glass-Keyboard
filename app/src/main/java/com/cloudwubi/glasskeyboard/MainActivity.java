package com.cloudwubi.glasskeyboard;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {

    private static final int REQ_MIC = 17;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        int pad = dp(22);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, dp(48), pad, pad);
        root.setGravity(Gravity.CENTER_HORIZONTAL);

        TextView logo = new TextView(this);
        logo.setText("云五笔 · 玻璃键盘");
        logo.setTextColor(Color.WHITE);
        logo.setTextSize(26);
        logo.setGravity(Gravity.CENTER);
        logo.setPadding(0, dp(10), 0, dp(6));
        root.addView(logo);

        TextView sub = new TextView(this);
        sub.setText("iOS 27 液态玻璃 · 五笔 / 语音 / 中英混输 / 实时计算");
        sub.setTextColor(0xFFBFE9F5);
        sub.setTextSize(13);
        sub.setGravity(Gravity.CENTER);
        sub.setPadding(0, 0, 0, dp(28));
        root.addView(sub);

        TextView steps = new TextView(this);
        steps.setText("启用只需三步：\n\n1. 点「启用键盘」，在系统设置中打开「云五笔·玻璃键盘」\n\n2. 点「切换键盘」，选择本输入法\n\n3. 点「授权麦克风」，启用语音输入（可稍后授权）\n\n启用后，在任意 App 的输入框中即可调出玻璃键盘。");
        steps.setTextColor(Color.WHITE);
        steps.setTextSize(15);
        steps.setLineSpacing(dp(4), 1.05f);
        steps.setPadding(dp(16), dp(16), dp(16), dp(16));
        steps.setBackgroundColor(0x33102A3D);
        LinearLayout.LayoutParams stp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        stp.setMargins(0, 0, 0, dp(26));
        steps.setLayoutParams(stp);
        root.addView(steps);

        root.addView(makeButton("① 启用键盘（系统设置）", true, v -> {
            try {
                startActivity(new Intent(Settings.ACTION_INPUT_METHOD_SETTINGS));
            } catch (Exception e) {
                Toast.makeText(this, "请手动进入 设置 → 系统 → 语言和输入法 → 管理键盘", Toast.LENGTH_LONG).show();
            }
        }));
        root.addView(makeButton("② 切换到云五笔·玻璃键盘", true, v -> {
            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) imm.showInputMethodPicker();
        }));
        root.addView(makeButton("③ 授权麦克风（语音输入）", false, v -> requestMic()));

        TextView tip = new TextView(this);
        tip.setText("提示：这是真机实测版（lite）。语音使用安卓系统免费语音识别；翻译需联网。");
        tip.setTextColor(0xFF8FC6D8);
        tip.setTextSize(12);
        tip.setPadding(0, dp(24), 0, 0);
        root.addView(tip);

        setContentView(root);

        // 打开 App（含从键盘语音面板跳转）即主动申请麦克风权限
        if (Build.VERSION.SDK_INT >= 23
                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            root.postDelayed(this::requestMic, 400);
        }
    }

    private Button makeButton(String text, boolean primary, android.view.View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(text);
        b.setTextSize(15);
        b.setAllCaps(false);
        if (primary) {
            b.setBackgroundColor(0xFF12A9C8);
            b.setTextColor(Color.WHITE);
        } else {
            b.setBackgroundColor(0x227FE8FF);
            b.setTextColor(0xFFBFE9F5);
        }
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(6), 0, dp(6));
        b.setLayoutParams(lp);
        b.setPadding(dp(10), dp(10), dp(10), dp(10));
        b.setOnClickListener(l);
        return b;
    }

    private void requestMic() {
        if (Build.VERSION.SDK_INT >= 23) {
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "麦克风已授权", Toast.LENGTH_SHORT).show();
                return;
            }
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_MIC) {
            boolean ok = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            Toast.makeText(this, ok ? "麦克风已授权，可使用语音输入" : "未授权，语音输入不可用", Toast.LENGTH_SHORT).show();
        }
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }
}

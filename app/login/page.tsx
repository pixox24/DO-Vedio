"use client";

import { FormEvent, useState } from "react";

function safeNextPath(value: string | null): string {
  return value && value.startsWith("/") && !/^\/[\\/]/.test(value) ? value : "/";
}

export default function LoginPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        setError("访问令牌错误，请重试。");
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.assign(safeNextPath(next));
    } catch {
      setError("登录请求失败，请检查服务是否仍在运行。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center justify-center py-16">
      <section className="panel w-full p-7 sm:p-9">
        <p className="label">访问保护</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">输入访问令牌</h1>
        <p className="mt-3 text-sm leading-6 text-white/50">此实例已启用共享访问保护。令牌只会保存为 HttpOnly Cookie。</p>
        <form className="mt-7 space-y-5" onSubmit={submit}>
          <label className="block space-y-2">
            <span className="label">访问令牌</span>
            <input
              className="input"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
          </label>
          {error && <p className="text-sm text-red-300" role="alert">{error}</p>}
          <button className="btn btn-primary w-full" type="submit" disabled={busy || !token.trim()}>
            {busy ? "验证中…" : "进入项目"}
          </button>
        </form>
      </section>
    </div>
  );
}

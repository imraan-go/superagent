"""Mediated browser controller that runs INSIDE the E2B browser sandbox.

It is invoked once per action by the trusted worker through the authenticated E2B command API and
connects to Google Chrome's DevTools endpoint on 127.0.0.1 inside the sandbox. The CDP port is never
exposed publicly. It holds no credentials and performs exactly one validated action per call.
"""
import base64
import json
import os
import sys
import time
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

CDP = "http://127.0.0.1:9222"
SHOTS = "/tmp/superagent/shots"
DL = "/tmp/superagent/downloads"
MAX_DL = 10 * 1024 * 1024

INDEX_JS = r"""
() => {
  const sel = 'a[href], button, input, select, textarea, [role=button], [role=link], [contenteditable=true]';
  const out = [];
  let i = 0;
  document.querySelectorAll('[data-sa-idx]').forEach(e => e.removeAttribute('data-sa-idx'));
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || st.visibility === 'hidden' || st.display === 'none') continue;
    el.setAttribute('data-sa-idx', String(i));
    const label = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    out.push({ i, tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '', label, href: el.href || '' });
    if (++i >= 150) break;
  }
  return out;
}
"""


def host_allowed(url, allowed):
    try:
        u = urlparse(url)
    except Exception:
        return False
    if u.scheme not in ("http", "https"):
        return url == "about:blank"
    h = (u.hostname or "").lower().rstrip(".")
    for d in allowed:
        d = d.lower()
        if d.startswith("*."):
            if h.endswith(d[1:]) and len(h) > len(d) - 1:
                return True
        elif h == d or h == "www." + d:
            return True
    return False


def guard_navigation(page, allowed):
    def handler(route):
        req = route.request
        if req.is_navigation_request() and req.frame == page.main_frame and not host_allowed(req.url, allowed):
            route.abort("blockedbyclient")
        else:
            route.continue_()

    page.route("**/*", handler)


def summarize(page):
    try:
        text = page.inner_text("body", timeout=5000)
    except Exception:
        text = ""
    text = " ".join(text.split())
    return {"url": page.url, "title": page.title(), "text": text[:12000], "textTruncated": len(text) > 12000}


def is_submitting(el):
    return el.evaluate(
        """e => {
          const t = (e.getAttribute('type') || '').toLowerCase();
          if (e.tagName === 'INPUT' && (t === 'submit' || t === 'image')) return true;
          if (e.tagName === 'BUTTON' && e.form && (t === '' || t === 'submit')) return true;
          return false;
        }"""
    )


def main():
    req = json.loads(base64.b64decode(os.environ["BCTL_REQ"]).decode())
    action = req["action"]
    allowed = req.get("allowed", [])
    if action == "version":
        print(json.dumps({"ok": True}))
        return
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP, timeout=15000)
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.set_default_timeout(20000)
        guard_navigation(page, allowed)
        res = {"ok": True}
        if action == "navigate":
            r = page.goto(req["url"], wait_until="domcontentloaded", timeout=30000)
            try:
                page.wait_for_load_state("networkidle", timeout=5000)
            except Exception:
                pass
            res.update({"status": r.status if r else None, "url": page.url, "title": page.title()})
        elif action == "read":
            res.update(summarize(page))
            res["elements"] = page.evaluate(INDEX_JS)
        elif action == "screenshot":
            os.makedirs(SHOTS, exist_ok=True)
            path = f"{SHOTS}/{int(time.time() * 1000)}.png"
            page.screenshot(path=path, full_page=bool(req.get("fullPage")), timeout=20000)
            res.update({"path": path, "url": page.url, "title": page.title()})
        elif action in ("click", "type"):
            page.evaluate(INDEX_JS)
            el = page.query_selector(f'[data-sa-idx="{int(req["element"])}"]')
            if el is None:
                res = {"ok": False, "error": "element not found; call browser_read again"}
            elif action == "click":
                href = el.evaluate("e => e.href || ''")
                if href and not href.startswith("javascript:") and not host_allowed(href, allowed):
                    res = {"ok": False, "error": "link leads outside the approved domains"}
                elif is_submitting(el):
                    res = {"ok": False, "error": "form submission is blocked until an approval path exists"}
                else:
                    el.click(timeout=10000)
                    try:
                        page.wait_for_load_state("domcontentloaded", timeout=10000)
                    except Exception:
                        pass
                    res.update({"url": page.url, "title": page.title()})
            else:
                kind = el.evaluate("e => [e.tagName.toLowerCase(), (e.getAttribute('type')||'').toLowerCase(), e.getAttribute('autocomplete')||'']")
                tag, typ, auto = kind
                if tag not in ("input", "textarea") or typ in ("password", "file", "hidden", "submit", "button", "checkbox", "radio") or "password" in auto or "cc-" in auto:
                    res = {"ok": False, "error": "typing is only allowed into ordinary text/search fields"}
                else:
                    el.fill(str(req["text"])[:500], timeout=10000)
                    res.update({"url": page.url})
        elif action == "scroll":
            page.mouse.wheel(0, 700 if req.get("direction") == "down" else -700)
            page.wait_for_timeout(300)
            res.update({"url": page.url})
        elif action == "blank":
            page.goto("about:blank")
            res.update({"url": page.url})
        elif action == "download":
            os.makedirs(DL, exist_ok=True)
            r = ctx.request.get(req["url"], timeout=30000, max_redirects=5)
            final = r.url
            if not host_allowed(final, allowed):
                res = {"ok": False, "error": "download redirected outside the approved domains"}
            else:
                body = r.body()
                if len(body) > MAX_DL:
                    res = {"ok": False, "error": f"file is larger than {MAX_DL} bytes"}
                else:
                    path = f"{DL}/{int(time.time() * 1000)}.bin"
                    with open(path, "wb") as f:
                        f.write(body)
                    res.update({"path": path, "status": r.status, "url": final, "contentType": r.headers.get("content-type", ""), "size": len(body)})
        else:
            res = {"ok": False, "error": f"unknown action {action}"}
        print("SA_RESULT " + json.dumps(res))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print("SA_RESULT " + json.dumps({"ok": False, "error": f"{type(e).__name__}: {str(e)[:300]}"}))
        sys.exit(0)

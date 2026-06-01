"""Silent (no pop-up) printing via Chrome kiosk printing.

The review app renders an A4 record as HTML, writes it to a temp file, and opens
it in Chrome with --kiosk-printing, which sends it straight to the default
printer with NO print dialog. Adapted from the finance CLI's Selenium approach.

Printing runs on the machine hosting this Flask app (that's where the printer
is) and on a background thread, so approving a transaction returns instantly.

Configuration (all optional) lives in secret_config.py — no environment vars:
  PRINTING_ENABLED   bool  master switch (default True)
  PRINT_HEADLESS     bool  hide the Chrome window entirely (default True). Set
                           False to mirror the classic visible-window-that-
                           auto-closes behavior if headless printing misbehaves.
  CHROME_BINARY      str   path to chrome.exe (default: let Selenium find it)
  CHROMEDRIVER_PATH  str   path to chromedriver (default: Selenium Manager auto)
  PRINTER_NAME       str   target printer name (default: the OS default printer)

Everything is best-effort: if Selenium/Chrome is missing or a print fails, it
logs and the work is abandoned silently; approving a transaction still succeeds.
"""

import os
import time
import json
import tempfile
import threading

try:
    import secret_config as _cfg
except Exception:
    _cfg = None


def _get(name, default=None):
    return getattr(_cfg, name, default) if _cfg else default


def _selenium_present():
    try:
        import selenium  # noqa: F401
        return True
    except Exception:
        return False


def is_enabled():
    return bool(_get("PRINTING_ENABLED", True))


# Capability is probed once (Chrome is actually launched and discarded) and
# cached, because "selenium is importable" does NOT guarantee a working Chrome +
# chromedriver. Without this, a machine with Selenium installed but no usable
# driver would report success, fail silently on a background thread, and the
# client would never open the fallback tab — losing the printout entirely.
_capable = None
_capable_lock = threading.Lock()


def _probe():
    """Build then immediately discard a driver to confirm silent printing works
    on this machine. Returns True/False; never raises."""
    driver = None
    try:
        driver = _build_driver()
        return True
    except Exception as e:
        _log(f"Silent printing unavailable — using print-tab fallback. Reason: {e}")
        return False
    finally:
        if driver is not None:
            try:
                driver.quit()
            except Exception:
                pass


def is_available():
    """Can this machine print silently? Runs a one-time cached Chrome probe, so
    the first call may take a couple of seconds; later calls are instant. When
    False, the caller should open a print tab so a printout is never lost."""
    global _capable
    if not is_enabled() or not _selenium_present():
        return False
    with _capable_lock:
        if _capable is None:
            _capable = _probe()
        return _capable


def warm_up():
    """Probe printing capability in the background at startup so the first
    approval isn't delayed by the one-time Chrome launch."""
    if is_enabled() and _selenium_present():
        threading.Thread(target=is_available, daemon=True).start()


def _log(msg):
    try:
        from flask import current_app
        current_app.logger.warning(msg)
    except Exception:
        print(msg)


def _print_app_state(printer_name):
    """Chrome's print-preview 'appState'. With a named local printer Chrome
    selects it; otherwise the empty list keeps the OS default printer."""
    state = {
        "recentDestinations": [],
        "selectedDestinationId": printer_name or "",
        "version": 2,
        "isHeaderFooterEnabled": False,
        "marginsType": 1,  # no margins (the A4 template controls its own layout)
    }
    if printer_name:
        state["recentDestinations"] = [{"id": printer_name, "origin": "local", "account": ""}]
    return json.dumps(state)


def _build_driver():
    """Create a Chrome driver configured for silent kiosk printing. Raises if
    Selenium or Chrome is unavailable."""
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service

    opts = Options()
    opts.add_argument("--kiosk-printing")          # auto-print, no dialog
    if _get("PRINT_HEADLESS", True):
        opts.add_argument("--headless=new")        # no visible window (Chrome 109+)
    opts.add_argument("--disable-gpu")
    opts.add_argument("--no-first-run")
    opts.add_argument("--disable-extensions")

    chrome_binary = _get("CHROME_BINARY", "")
    if chrome_binary:
        opts.binary_location = chrome_binary

    opts.add_experimental_option("prefs", {
        "printing.print_preview_sticky_settings.appState": _print_app_state(_get("PRINTER_NAME", "")),
        "savefile.default_directory": tempfile.gettempdir(),
    })

    driver_path = _get("CHROMEDRIVER_PATH", "")
    service = Service(executable_path=driver_path) if driver_path else Service()
    return webdriver.Chrome(service=service, options=opts)


def _print_html_sync(html, tag):
    """Write `html` to a temp file and silently print it via Chrome kiosk mode.
    Returns True on success. Never raises."""
    path = None
    driver = None
    try:
        fd, path = tempfile.mkstemp(prefix=f"wf_{tag}_", suffix=".html")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(html)

        driver = _build_driver()
        driver.get("file:///" + path.replace("\\", "/"))
        driver.execute_script("window.print();")
        time.sleep(3)  # let the print spooler pick up the job before we exit
        return True
    except Exception as e:
        _log(f"Silent print failed: {e}")
        return False
    finally:
        if driver is not None:
            try:
                driver.quit()
            except Exception:
                pass
        if path and os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass


def print_html_async(html, tag="record"):
    """Print `html` on a background daemon thread so the request returns at once.
    Returns True if a print job was dispatched (machine can print), False if
    silent printing is unavailable and the caller should fall back to a tab."""
    if not is_available():
        return False
    threading.Thread(target=_print_html_sync, args=(html, tag), daemon=True).start()
    return True

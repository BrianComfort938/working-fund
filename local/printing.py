import os
import time
import json
import base64
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
        import selenium
        return True
    except Exception:
        return False

def is_enabled():
    return bool(_get("PRINT_SILENT", False))

_capable = None
_capable_lock = threading.Lock()

def _probe():
    driver = None
    try:
        driver = _build_driver()
        return True
    except Exception as e:
        _log(f"Silent printing unavailable, using the print tab fallback. Reason: {e}")
        return False
    finally:
        if driver is not None:
            try:
                driver.quit()
            except Exception:
                pass

def is_available():
    global _capable
    if not is_enabled() or not _selenium_present():
        return False
    with _capable_lock:
        if _capable is None:
            _capable = _probe()
        return _capable

def warm_up():
    if is_enabled() and _selenium_present():
        threading.Thread(target=is_available, daemon=True).start()

def _log(msg):
    try:
        from flask import current_app
        current_app.logger.warning(msg)
    except Exception:
        print(msg)

def _print_app_state(printer_name):
    state = {
        "recentDestinations": [],
        "selectedDestinationId": printer_name or "",
        "version": 2,
        "isHeaderFooterEnabled": False,
        "marginsType": 1,
    }
    if printer_name:
        state["recentDestinations"] = [{"id": printer_name, "origin": "local", "account": ""}]
    return json.dumps(state)

def _build_driver():
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service

    opts = Options()
    opts.add_argument("--kiosk-printing")
    if _get("PRINT_HEADLESS", True):
        opts.add_argument("--headless=new")
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
    path = None
    driver = None
    try:
        fd, path = tempfile.mkstemp(prefix=f"wf_{tag}_", suffix=".html")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(html)

        driver = _build_driver()
        driver.get("file:///" + path.replace("\\", "/"))
        driver.execute_script("window.print();")
        time.sleep(3)
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
    if not is_available():
        return False
    threading.Thread(target=_print_html_sync, args=(html, tag), daemon=True).start()
    return True

A4_CM = (21.0, 29.7)
A4_HEIGHT_PX = 1122.0
PDF_SAFETY_PX = 6.0

def pdf_capable():
    return _selenium_present()

def _fit_scale(driver):
    try:
        height = driver.execute_script(
            "var b=document.body;"
            "return Math.ceil(Math.max(b.scrollHeight,b.offsetHeight,"
            "b.getBoundingClientRect().height));"
        )
        height = float(height or 0)
    except Exception:
        height = 0.0
    usable = A4_HEIGHT_PX - PDF_SAFETY_PX
    if height <= usable:
        return 1.0
    return max(0.3, round(usable / height, 3))

def html_to_pdf(html, out_path, tag="pdf"):
    if not _selenium_present():
        return False

    from selenium.webdriver.common.print_page_options import PrintOptions

    path = None
    driver = None
    try:
        fd, path = tempfile.mkstemp(prefix=f"wf_{tag}_", suffix=".html")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(html)

        driver = _build_driver()
        try:
            driver.set_window_size(1100, 1600)
        except Exception:
            pass
        driver.get("file:///" + path.replace("\\", "/"))

        opts = PrintOptions()
        opts.page_width, opts.page_height = A4_CM
        opts.margin_top = opts.margin_bottom = 0
        opts.margin_left = opts.margin_right = 0
        opts.background = True
        opts.shrink_to_fit = False
        opts.scale = _fit_scale(driver)

        data = base64.b64decode(driver.print_page(opts))
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "wb") as f:
            f.write(data)
        return True
    except Exception as e:
        _log(f"PDF backup failed: {e}")
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

def save_pdf_async(html, out_path, tag="pdf"):
    if not _selenium_present():
        return False
    threading.Thread(target=html_to_pdf, args=(html, out_path, tag), daemon=True).start()
    return True

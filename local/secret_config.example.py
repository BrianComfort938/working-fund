"""Template for local-only configuration.

Copy this file to "secret_config.py" (same folder) and fill in your real values.
The real secret_config.py is gitignored, so credentials never get pushed.

Leave MONGODB_URI = "" to run the review app in DEMO mode with sample data.
"""

MONGODB_URI = "mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority"

MONGODB_DB = "workingfund"

# --- Local MySQL ledger -----------------------------------------------------
# Approved transactions are mirrored into a local MySQL table. The table is
# created automatically on first write, so a fresh database needs no setup.
# These are just the DEFAULTS: the review portal's Settings panel can change the
# table name, host, etc. at runtime, saving overrides to app_settings.json
# (gitignored) without touching this file. Set MYSQL_ENABLED = False on machines
# without a local MySQL server.
MYSQL_ENABLED = False
MYSQL_HOST = "localhost"
MYSQL_PORT = 3306
MYSQL_USER = "root"
MYSQL_PASSWORD = "your-mysql-password"
MYSQL_DB = "working_fund_db"
MYSQL_TABLE = "transactions_2025"

# --- Silent printing --------------------------------------------------------
# Approve prints the A4 record with no pop-up via Chrome --kiosk-printing.
# If this machine can't print silently (no Chrome/chromedriver), the app
# automatically falls back to opening the print tab, so nothing is lost.
PRINTING_ENABLED = True
PRINT_HEADLESS = True          # hide the Chrome window; set False to debug
PRINTER_NAME = ""              # "" = OS default printer, or e.g. "Brother HL-L2300"
CHROME_BINARY = ""             # "" = auto-detect, or full path to chrome.exe
CHROMEDRIVER_PATH = ""         # "" = Selenium Manager auto; set a path if that fails

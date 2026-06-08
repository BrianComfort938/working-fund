The system has three parts:

1. The phone page (folder `docs`): record transactions
2. The secure API (folder `api`): cloud deployment on vercel for the api. mongodb for the db. both are free
3. The Review Page (folder `local`): review transactions, write them to the local db and print the physical record.

## Open the Review Page

 Double-click **`Start Review Page.bat`** in this folder.
   - A Command Prompt opens. 
   - Activate automatically the virtual env
   - A web browser tab opens by itself and shows the Review Page.

Optionally you can add a shortcut on the desktop. Copy the path of the bat file and create a desktop shortcut.

## What the Review Page does

For each expense waiting in the queue you can:

- See the receipt photo or photos, the amount, the beneficiary, the account, and
  the signature.
- Fix any detail: beneficiary, account, amount, payment method, or which mission
  it belongs to.
- Switch between the **East** and **South** missions, and set the fund period
  number.
- Get a "possible duplicate" warning when a very similar expense was recorded
  before.
- **Approve** it. Approving will:
  - Save the record into a local database file, `workingfund.db`.
  - Add a line to a spreadsheet backup, `transaction-backup.csv`.
  - Print an A4 record automatcally if printing is set up. If it is not
    set up, the app opens a print tab and you can press print manually.
  - After every 100 rows, the CSV backup file is printed and then erased.

Approved and deleted items leave the cloud queue, so they are never reviewed
twice.


## Folder map

```
mission/
  Start Review Page.bat       <- double-click this to open the Review Page
  README.md                   <- this file
  SETUP.md                    <- how to set up the cloud parts
  docs/                       <- the phone page (GitHub Pages)
  api/                        <- the secure API (Vercel)
  local/                      <- the Review Page program (the office computer)
    app.py                    <- the program the .bat file starts
    requirements.txt          <- the list of pieces it needs
    secret_config.example.py  <- copy to secret_config.py to use real data
```

## If something goes wrong

- **No browser tab opened.** Look in the black window for a line like
  `Open http://127.0.0.1:5000/` and click it, or type that address into your web
  browser.
- **Automatic printing does not work** Ensure that the newest version of Chromeium is installed and the path is set in secrert_config.py
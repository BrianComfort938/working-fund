"""Account codes, per mission.

Each mission has its own chart of accounts, so changing South's list must never
touch East's. The browser side keeps its own copy in docs/accounts.js; change
both together.

CODES: the key is what gets stored as account_code; the value is what gets
stored and printed as account_name. The value always starts with the
"SERIES-ACCOUNT" number, which is what prf_export parses and what the series
colours key off, so keep that shape.
"""

EAST_SERIES = {
    "400": {"label": "Field", "color": "#2e7d32"},
    "000": {"label": "Admin", "color": "#00618a"},
    "480": {"label": "Senior", "color": "#6a3d9a"},
    "600": {"label": "Vehicle", "color": "#e3811d"},
    "900": {"label": "Travel / Medical", "color": "#b3261e"},
}

EAST_CODES = {
    "00": "400-5102 Travel In-field", "01": "400-5700 Furnishings YM",
    "02": "400-5930 Food and Personal Items", "03": "400-5868 Utilities YM",
    "04": "400-5862 Rent YM", "05": "400-5920 Charitable Assistance",
    "06": "400-5221 Book of Mormon", "10": "000-5102 Travel Admin",
    "11": "000-5496 Luncheons, Socials & Hosting",
    "12": "000-5860 Small Purchases/Services for Mission Home & Office",
    "13": "000-5500 Miscellaneous", "14": "000-5370 Telephone and Internet",
    "15": "000-5221 Teaching Literature and Supplies",
    "16": "000-5200 Operating materials and supplies",
    "17": "000-5170 Vehicle Gasoline", "18": "000-5379 Postage and Mailing",
    "19": "000-5700 Small Office Equipment", "20": "000-5461 Bank Fees",
    "21": "000-5776 Small Office Equipment and Maintenance",
    "22": "000-5862 Rent Admin", "23": "000-5868 Utilities Admin",
    "30": "480-5862 Rent SM", "31": "480-5700 Furnishings SM",
    "32": "480-5868 Utilities SM", "40": "600-5480 Vehicle Taxes and Fees",
    "41": "600-5700 Vehicle Equipment", "42": "600-5772 Vehicle Maintenance and repairs",
    "50": "900-5102 Travel, Baggage, Visa and Other", "51": "900-5949 Missionary Medical",
}

SOUTH_SERIES = {
    "000": {"label": "Admin", "color": "#00618a"},
    "400": {"label": "Support", "color": "#2e7d32"},
    "480": {"label": "Couples", "color": "#6a3d9a"},
    "600": {"label": "Vehicles", "color": "#e3811d"},
    "900": {"label": "Other", "color": "#b3261e"},
}

SOUTH_CODES = {
    "00": "400-5102 Travel - Baggage, Visa Other (Support)",
    "01": "400-5700 Furnishings (Support)",
    "02": "400-5930 Food and Other Expenses (Support)",
    "03": "400-5868 Utilities (Support)",
    "04": "400-5862 Rent (Support)",
    "05": "400-5920 Charitable Assistance (Support)",
    "10": "000-5102 Travel - Baggage, Visa Other (Admin)",
    "11": "000-5496 Luncheons, Socials, and Hosting (Admin)",
    "12": "000-5860 Small Purch/Serv for Mission Home (Admin)",
    "13": "000-5500 Miscellaneous (Admin)",
    "14": "000-5370 Telephone and Internet (Admin)",
    "15": "000-5221 Teaching Literature and Supplies (Admin)",
    "16": "000-5200 Operating Materials and Supplies (Admin)",
    "17": "000-5170 Vehicle Gasoline (Admin)",
    "18": "000-5379 Postage and Mailing (Admin)",
    "19": "000-5700 Furnishings (Admin)",
    "20": "000-5461 Bank Service Charges and Fees (Admin)",
    "21": "000-5776 Small Equipment Maintenance (Admin)",
    "22": "000-5862 Rent (Admin)",
    "23": "000-5868 Utilities (Admin)",
    "31": "480-5700 Furnishings (Couples)",
    "30": "480-5862 Rent (Couples)",
    "32": "480-5868 Utilities (Couples)",
    "40": "600-5480 Vehicle Taxes and Fees (Vehicles)",
    "41": "600-5700 Furnishings (Vehicles)",
    "42": "600-5772 Vehicle Maintenance and Repairs (Vehicles)",
    "50": "900-5102 Travel - Baggage, Visa Other (Other)",
    "51": "900-5949 Missionary Medical (Other)",
    "52": "900-1300 Missionary Accounts (Other)",
}

BY_MISSION = {
    "east": {"glPrefix": "1385", "series": EAST_SERIES, "codes": EAST_CODES},
    "south": {"glPrefix": "1389", "series": SOUTH_SERIES, "codes": SOUTH_CODES},
}

DEFAULT_MISSION = "east"

def for_mission(mission):
    return BY_MISSION.get(mission) or BY_MISSION[DEFAULT_MISSION]

def codes(mission):
    return for_mission(mission)["codes"]

def gl_prefix(mission):
    return for_mission(mission)["glPrefix"]

def name(mission, code):
    """The account name for a code, falling back to the other missions.

    A transaction recorded before South got its own chart of accounts still
    carries an East code, so labels for old rows keep resolving.
    """
    code = (code or "").strip()
    if not code:
        return ""
    hit = codes(mission).get(code)
    if hit is not None:
        return hit
    for m in BY_MISSION:
        hit = BY_MISSION[m]["codes"].get(code)
        if hit is not None:
            return hit
    return ""

"""
Walk the iOS app on a real BrowserStack iPhone and save a screenshot per step (qa/ios/, git-ignored).

  pip install Appium-Python-Client
  BSTACK_USERNAME=… BSTACK_ACCESS_KEY=… python scripts/ios-smoke.py path/to/app.ipa [--sample]

--sample taps "Try with sample data" (no account needed). Without it, signs in with UPPCL_USER / UPPCL_PASS:
the password is typed with BrowserStack's command masking, never printed. Read-only: it opens the Pay sheet
and the complaint sheet but never pays or files. Video and network logs are off.
"""
import json, os, subprocess, sys, time
from appium import webdriver
from appium.options.ios import XCUITestOptions
from appium.webdriver.common.appiumby import AppiumBy

ipa = sys.argv[1]
sample = "--sample" in sys.argv
device = os.environ.get("IOS_DEVICE", "iPhone 15")
user, key = os.environ["BSTACK_USERNAME"], os.environ["BSTACK_ACCESS_KEY"]
out = os.path.join(os.path.dirname(__file__), "..", "qa", "ios", device.replace(" ", "-"))
os.makedirs(out, exist_ok=True)

up = json.loads(subprocess.run(["curl", "-s", "-u", f"{user}:{key}", "-X", "POST",
    "https://api-cloud.browserstack.com/app-automate/upload", "-F", f"file=@{ipa}"], capture_output=True, text=True, check=True).stdout)
if "app_url" not in up: sys.exit(f"upload failed: {up.get('error', up)}")

o = XCUITestOptions()
o.set_capability("app", up["app_url"])
o.set_capability("bstack:options", {
    "userName": user, "accessKey": key, "deviceName": device, "osVersion": os.environ.get("IOS_VERSION", "17"),
    "projectName": "UPPCL Pro", "buildName": "ios-smoke", "sessionName": "sample" if sample else "real account",
    "video": False, "networkLogs": False, "appiumLogs": False, "deviceLogs": True,
    "maskCommands": "setValues, getValues, setCookies, getCookies",
})
d = webdriver.Remote(f"https://{user}:{key}@hub-cloud.browserstack.com/wd/hub", options=o)
d.implicitly_wait(2)
n = 0
log: list[str] = []

def shot(name: str):
    global n
    n += 1
    d.save_screenshot(os.path.join(out, f"{n:02d}-{name}.png"))

def find(label: str, wait=20):
    """An element whose accessibility label contains `label` (RN Text and Pressable both expose one)."""
    end = time.time() + wait
    # Exact button first ("Sign in" must not hit "Sign in with your UPPCL SMART account"), then any match.
    queries = [f'type == "XCUIElementTypeButton" AND label == "{label}" AND visible == 1',
               f'type == "XCUIElementTypeButton" AND label BEGINSWITH "{label}" AND visible == 1',
               f'label CONTAINS "{label}" AND visible == 1']
    while time.time() < end:
        for q in queries:
            els = d.find_elements(AppiumBy.IOS_PREDICATE, q)
            if els: return els[0]
        time.sleep(1)
    raise TimeoutError(label)

def tap(label: str, wait=20):
    find(label, wait).click()

def step(name: str, fn):
    try:
        fn(); time.sleep(2); shot(name); log.append(f"ok   {name}")
    except Exception as e:
        shot(name + "-FAILED"); log.append(f"FAIL {name}: {type(e).__name__} {str(e)[:120]}")

try:
    time.sleep(4); shot("launch")
    if sample:
        step("sample-home", lambda: tap("Try with sample data"))
    else:
        def sign_in():
            f = d.find_elements(AppiumBy.CLASS_NAME, "XCUIElementTypeTextField")[0]
            f.click(); f.send_keys(os.environ["UPPCL_USER"])
            p = d.find_elements(AppiumBy.CLASS_NAME, "XCUIElementTypeSecureTextField")[0]
            p.click(); p.send_keys(os.environ["UPPCL_PASS"])
            tap("Sign in")
            find("Home", 90)  # tab bar: signed in (sign-in solves a proof-of-work first)
        step("home", sign_in)
    step("no-power-sheet", lambda: tap("No power?"))
    step("full-form", lambda: tap("Something else?"))
    step("back-to-home", lambda: tap("Back"))  # iOS has no system back: the screen's own arrow
    for tab in ["Usage", "Bills", "Complaints", "Home"]:
        step(f"tab-{tab.lower()}", lambda tab=tab: tap(tab))
    step("pay-sheet", lambda: tap("Pay"))
    step("close-pay", lambda: d.execute_script("mobile: swipe", {"direction": "down"}))
    step("settings", lambda: tap("Settings"))
    step("settings-bottom", lambda: d.execute_script("mobile: swipe", {"direction": "up"}))
    print("\n".join(log))
    print(f"screenshots: {os.path.abspath(out)}")
finally:
    d.quit()

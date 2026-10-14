#!/usr/bin/env python3
"""Create 3 paid, fulfilled demo orders for recording a returns-management (RMS) app walkthrough.

orderCreate needs an offline token, which Shopify CLI logins don't have, so each order is made the
way you would in the admin: create a draft order, complete it as paid, then fulfil it.
Customers and addresses are fictional. Set RMS_DEMO_EMAILS to three comma-separated inboxes you own so
customer logins can be demoed (defaults are example.com placeholders); no emails are sent at creation. Orders are tagged `rms-demo` so they are
easy to find and delete afterwards. Skips creation if rms-demo orders already exist.

Requires: shopify store auth ... --scopes ...,write_draft_orders,write_orders,
          write_merchant_managed_fulfillment_orders
Usage: RMS_DEMO_EMAILS=a@x.com,b@x.com,c@x.com store-content/create-demo-orders.py [--store rgb-leather.myshopify.com]
"""
import argparse, json, os, subprocess, sys

ap = argparse.ArgumentParser()
ap.add_argument("--store", default="rgb-leather.myshopify.com")
args = ap.parse_args()


def gql(query, variables=None, mutation=False):
    cmd = ["shopify", "store", "execute", "--store", args.store, "--json", "--no-color", "-q", query]
    if variables is not None:
        cmd += ["-v", json.dumps(variables)]
    if mutation:
        cmd.append("--allow-mutations")
    r = subprocess.run(cmd, capture_output=True, text=True)
    # The CLI writes JSON progress lines before the result; keep only real output for errors.
    noise = lambda s: "\n".join(l for l in s.splitlines() if '"type":"progress"' not in l).strip()
    out = r.stdout[r.stdout.find("\n{\n") + 1:] if "\n{\n" in r.stdout else r.stdout
    if r.returncode != 0 or not out.strip().startswith("{"):
        sys.exit(f"shopify store execute failed (exit {r.returncode}):\n"
                 f"{noise(r.stdout) or '(no stdout)'}\n{noise(r.stderr) or '(no stderr)'}")
    return json.loads(out)


def check(payload, key):
    if payload[key].get("userErrors"):
        sys.exit(f"{key} failed: {json.dumps(payload[key]['userErrors'], indent=2)}")
    return payload[key]


def address(first, last, street, city, province, zip_):
    return {"firstName": first, "lastName": last, "address1": street, "city": city, "province": province,
            "zip": zip_, "countryCode": "PH"}


EMAILS = (os.environ.get("RMS_DEMO_EMAILS") or
          "rms-demo-1@example.com,rms-demo-2@example.com,rms-demo-3@example.com").split(",")
if len(EMAILS) != 3:
    sys.exit("RMS_DEMO_EMAILS needs exactly three comma-separated addresses")

# Three scenarios an RMS demo usually needs: a simple return, a partial return from a
# multi-item order, and an exchange on a higher-value item.
ORDERS = [
    {"customer": ("Juan", "Dela Cruz", EMAILS[0].strip()),
     "address": ("123 Lopez Avenue", "Los Baños", "Laguna", "4030"),
     "items": [("leather-catch-bag", 1)],
     "note": "RMS demo 1: single item, full return"},
    {"customer": ("Maria", "Santos", EMAILS[1].strip()),
     "address": ("45 Rizal Street", "Calamba", "Laguna", "4027"),
     "items": [("personalised-leather-catch-bag", 1), ("leather-catch-bag", 1)],
     "note": "RMS demo 2: two items, partial return"},
    {"customer": ("Jose", "Reyes", EMAILS[2].strip()),
     "address": ("8 Mabini Street", "San Pablo", "Laguna", "4000"),
     "items": [("leather-tari-case-basket-weave", 1)],
     "note": "RMS demo 3: high-value item, exchange"},
]

existing = gql('{orders(first:10,query:"tag:rms-demo"){nodes{name}}}')["orders"]["nodes"]
if existing:
    sys.exit(f"rms-demo orders already exist: {', '.join(o['name'] for o in existing)}")

variant = {}
for o in ORDERS:
    for handle, _ in o["items"]:
        if handle not in variant:
            p = gql("query($h:String!){productByHandle(handle:$h){status variants(first:1){nodes{id}}}}",
                    {"h": handle})["productByHandle"]
            if not p or p["status"] != "ACTIVE":
                sys.exit(f"{handle} is missing or not active")
            variant[handle] = p["variants"]["nodes"][0]["id"]

for i, o in enumerate(ORDERS, 1):
    first, last, email = o["customer"]
    addr = address(first, last, *o["address"])
    draft = check(gql("""mutation($input:DraftOrderInput!){draftOrderCreate(input:$input){
        draftOrder{id} userErrors{field message}}}""",
        {"input": {"email": email, "shippingAddress": addr, "billingAddress": addr,
                   "lineItems": [{"variantId": variant[h], "quantity": q} for h, q in o["items"]],
                   "tags": ["rms-demo"], "note": o["note"]}}, mutation=True), "draftOrderCreate")["draftOrder"]

    # Completing without paymentPending marks the order as paid (like "Mark as paid" in the admin).
    order = check(gql("""mutation($id:ID!){draftOrderComplete(id:$id){draftOrder{order{id name
        totalPriceSet{shopMoney{amount currencyCode}}}} userErrors{field message}}}""",
        {"id": draft["id"]}, mutation=True), "draftOrderComplete")["draftOrder"]["order"]

    fos = gql("""query($id:ID!){order(id:$id){fulfillmentOrders(first:5){nodes{id status}}}}""",
              {"id": order["id"]})["order"]["fulfillmentOrders"]["nodes"]
    check(gql("""mutation($f:FulfillmentInput!){fulfillmentCreate(fulfillment:$f){fulfillment{id status}
        userErrors{field message}}}""",
        {"f": {"lineItemsByFulfillmentOrder": [{"fulfillmentOrderId": fo["id"]} for fo in fos if fo["status"] == "OPEN"],
               "notifyCustomer": False,
               "trackingInfo": {"company": "LBC", "number": f"RMSDEMO{i:04d}"}}}, mutation=True), "fulfillmentCreate")

    final = gql("""query($id:ID!){order(id:$id){displayFinancialStatus displayFulfillmentStatus}}""",
                {"id": order["id"]})["order"]
    money = order["totalPriceSet"]["shopMoney"]
    print(f"{order['name']}  {first} {last}  {final['displayFinancialStatus']}/{final['displayFulfillmentStatus']}  "
          f"{money['currencyCode']} {float(money['amount']):,.2f}  — {o['note']}")

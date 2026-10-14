#!/usr/bin/env python3
"""Set SKU, weight, inventory tracking, starting stock and product category on every RGB product.

Starting stock is only applied to items that currently have 0 available, so re-running never
overwrites real stock counts. Setting quantities needs the write_inventory scope.

Usage: store-content/fix-products.py [--store rgb-leather.myshopify.com] [--stock 5]
"""
import argparse, json, subprocess, sys, uuid

ap = argparse.ArgumentParser()
ap.add_argument("--store", default="rgb-leather.myshopify.com")
ap.add_argument("--stock", type=int, default=5)
args = ap.parse_args()


def gql(query, variables=None, mutation=False):
    cmd = ["shopify", "store", "execute", "--store", args.store, "--json", "--no-color", "-q", query]
    if variables is not None:
        cmd += ["-v", json.dumps(variables)]
    if mutation:
        cmd.append("--allow-mutations")
    r = subprocess.run(cmd, capture_output=True, text=True)
    noise = lambda s: "\n".join(l for l in s.splitlines() if '"type":"progress"' not in l).strip()
    out = r.stdout[r.stdout.find("\n{\n") + 1:] if "\n{\n" in r.stdout else r.stdout
    if r.returncode != 0 or not out.strip().startswith("{"):
        sys.exit(f"shopify store execute failed (exit {r.returncode}):\n{noise(r.stdout)}\n{noise(r.stderr)}")
    return json.loads(out)


def check(payload, key, errors="userErrors"):
    if payload[key].get(errors):
        sys.exit(f"{key} failed: {json.dumps(payload[key][errors], indent=2)}")
    return payload[key]


BRIEFCASES, CARRIERS, TOOL_STORAGE, PET_SUPPLIES = "lb-2", "ap-2-16", "ha-6-24", "ap-2"
# handle: (SKU, weight in kg, taxonomy category)
PRODUCTS = {
    "leather-tari-case-basket-weave":          ("RGB-TC24-BW", 2.5, BRIEFCASES),
    "leather-tari-case-crocodile":             ("RGB-TC24-CR", 2.5, BRIEFCASES),
    "leather-tari-case-square-shoulder-strap": ("RGB-TC24-SQ", 2.5, BRIEFCASES),
    "custom-6-capacity-floral":                ("RGB-TC06-CF", 1.0, BRIEFCASES),
    "custom-36-capacity-combination-lock":     ("RGB-TC36-CL", 3.0, BRIEFCASES),
    "custom-36-capacity-latch-lock":           ("RGB-TC36-LL", 3.0, BRIEFCASES),
    "custom-36-capacity-crest":                ("RGB-TC36-CR", 3.0, BRIEFCASES),
    "custom-36-capacity-old-type":             ("RGB-TC36-OT", 3.0, BRIEFCASES),
    "custom-48-capacity-shield-logo":          ("RGB-TC48-SH", 3.5, BRIEFCASES),
    "custom-48-capacity-lucky-box":            ("RGB-TC48-FL", 3.5, BRIEFCASES),
    "leather-catch-bag":                       ("RGB-CB-STD", 0.6, CARRIERS),
    "personalised-leather-catch-bag":          ("RGB-CB-PER", 0.6, CARRIERS),
    "leather-catch-bag-foam-padded":           ("RGB-CB-FOA", 0.7, CARRIERS),
    "leather-takera":                          ("RGB-TK-STD", 0.3, TOOL_STORAGE),
    "leather-takera-tri-kolor":                ("RGB-TK-TRI", 0.3, TOOL_STORAGE),
    "leather-tari-sheath":                     ("RGB-SH-STD", 0.1, TOOL_STORAGE),
    "leather-sharpener-case":                  ("RGB-SC-STD", 0.1, TOOL_STORAGE),
    "personalised-sharpener-case":             ("RGB-SC-PER", 0.1, TOOL_STORAGE),
    "leather-arm-protector":                   ("RGB-AP-STD", 0.3, PET_SUPPLIES),
}

stock_changes = []
for handle, (sku, kg, category) in PRODUCTS.items():
    # Use the location the item is actually stocked at (the store also has a sample-data location).
    p = gql("""query($h:String!){productByHandle(handle:$h){id variants(first:1){nodes{id
        inventoryItem{id inventoryLevels(first:1){nodes{location{id name} quantities(names:["available"]){quantity}}}}}}}}""",
            {"h": handle})["productByHandle"]
    if not p:
        print(f"  missing {handle}")
        continue
    v = p["variants"]["nodes"][0]
    check(gql("""mutation($p:ProductUpdateInput!){productUpdate(product:$p){product{id} userErrors{field message}}}""",
              {"p": {"id": p["id"], "category": f"gid://shopify/TaxonomyCategory/{category}"}}, mutation=True), "productUpdate")
    check(gql("""mutation($pid:ID!,$v:[ProductVariantsBulkInput!]!){productVariantsBulkUpdate(productId:$pid,variants:$v){
        userErrors{field message}}}""",
        {"pid": p["id"], "v": [{"id": v["id"], "inventoryPolicy": "DENY",
                                 "inventoryItem": {"sku": sku, "tracked": True, "requiresShipping": True,
                                                   "measurement": {"weight": {"value": kg, "unit": "KILOGRAMS"}}}}]},
        mutation=True), "productVariantsBulkUpdate")
    level = v["inventoryItem"]["inventoryLevels"]["nodes"][0]
    available = level["quantities"][0]["quantity"]
    if available == 0:
        stock_changes.append({"inventoryItemId": v["inventoryItem"]["id"], "locationId": level["location"]["id"],
                              "quantity": args.stock, "changeFromQuantity": 0})
    print(f"  {handle:42} {sku:12} {kg} kg  stock {'→ ' + str(args.stock) if available == 0 else f'kept at {available}'}  @ {level['location']['name']}")

if stock_changes:
    # The API requires an idempotency key so a retried request can't apply the change twice.
    d = gql("""mutation($input:InventorySetQuantitiesInput!,$key:String!){inventorySetQuantities(input:$input) @idempotent(key:$key){
        inventoryAdjustmentGroup{id} userErrors{field message}}}""",
        {"input": {"name": "available", "reason": "correction", "quantities": stock_changes},
         "key": str(uuid.uuid4())}, mutation=True)
    check(d, "inventorySetQuantities")
    print(f"Set starting stock of {args.stock} on {len(stock_changes)} products")

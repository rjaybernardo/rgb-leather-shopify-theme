#!/usr/bin/env python3
"""Load RGB LeatherCrafts content into a Shopify store with the Shopify CLI.

Uploads the theme images to Files, then creates (or skips, if they already exist) the
collections, products, About/Contact pages and main menu described in catalog.json.
Products without a confirmed price are created as drafts.

Requires a prior:
  shopify store auth --store rgb-leather.myshopify.com --scopes \
    write_products,write_files,write_publications,write_online_store_pages,write_online_store_navigation

Usage: store-content/setup-store.py [--store rgb-leather.myshopify.com] [--dry-run]
"""
import argparse, json, mimetypes, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
IMAGES = os.path.join(HERE, "images")
VENDOR = "RGB LeatherCrafts"

ap = argparse.ArgumentParser()
ap.add_argument("--store", default="rgb-leather.myshopify.com")
ap.add_argument("--dry-run", action="store_true")
args = ap.parse_args()
catalog = json.load(open(os.path.join(HERE, "catalog.json")))


def gql(query, variables=None, mutation=False):
    cmd = ["shopify", "store", "execute", "--store", args.store, "--json", "--no-color", "-q", query]
    if variables is not None:
        cmd += ["-v", json.dumps(variables)]
    if mutation:
        cmd.append("--allow-mutations")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"shopify store execute failed:\n{r.stderr or r.stdout}")
    out = json.loads(r.stdout)
    data = out.get("data", out)
    if out.get("errors"):
        sys.exit(f"GraphQL errors: {json.dumps(out['errors'], indent=2)}")
    return data


def check(payload, key):
    errs = payload[key].get("userErrors") or []
    if errs:
        sys.exit(f"{key} failed: {json.dumps(errs, indent=2)}")
    return payload[key]


_staged = {}
def stage(rel):
    """Upload a local image to Shopify's staged storage; returns its resourceUrl."""
    if rel in _staged:
        return _staged[rel]
    path = os.path.join(IMAGES, rel)
    mime = mimetypes.guess_type(path)[0]
    d = gql("""mutation($input:[StagedUploadInput!]!){stagedUploadsCreate(input:$input){
        stagedTargets{url resourceUrl parameters{name value}} userErrors{field message}}}""",
        {"input": [{"resource": "IMAGE", "filename": os.path.basename(path), "mimeType": mime,
                    "httpMethod": "POST", "fileSize": str(os.path.getsize(path))}]}, mutation=True)
    t = check(d, "stagedUploadsCreate")["stagedTargets"][0]
    curl = ["curl", "-sS", "--fail", "-X", "POST", t["url"]]
    for p in t["parameters"]:
        curl += ["-F", f"{p['name']}={p['value']}"]
    curl += ["-F", f"file=@{path}"]
    subprocess.run(curl, check=True, capture_output=True)
    _staged[rel] = t["resourceUrl"]
    print(f"  uploaded {rel}")
    return t["resourceUrl"]


def alt_for(rel):
    return os.path.splitext(os.path.basename(rel))[0].replace("-", " ").capitalize()


# ---------------------------------------------------------------- plan / dry run
priced = [p for p in catalog["products"] if p["price"]]
print(f"Store: {args.store}")
print(f"Theme files to upload: {len(catalog['theme_files'])}")
print(f"Collections: {', '.join(c['handle'] for c in catalog['collections'])}")
print(f"Products: {len(catalog['products'])} ({len(priced)} active with price, "
      f"{len(catalog['products']) - len(priced)} draft without price)")
if args.dry_run:
    sys.exit(0)

shop = gql("{shop{name currencyCode} publications(first:20){nodes{id name}}}")
print(f"Connected to {shop['shop']['name']} ({shop['shop']['currencyCode']})")
online_store = next((p["id"] for p in shop["publications"]["nodes"] if p["name"] == "Online Store"), None)

# ---------------------------------------------------------------- 1. theme images → Files
print("\n1. Theme images")
existing = gql("""query($q:String!){files(first:100,query:$q){nodes{... on MediaImage{image{url}}}}}""",
               {"q": "media_type:IMAGE"})["files"]["nodes"]
have = {os.path.basename(n["image"]["url"].split("?")[0]) for n in existing if n.get("image")}
new_files = [f for f in catalog["theme_files"] if os.path.basename(f) not in have]
if new_files:
    files = [{"originalSource": stage(f), "filename": os.path.basename(f), "contentType": "IMAGE",
              "alt": alt_for(f)} for f in new_files]
    check(gql("""mutation($files:[FileCreateInput!]!){fileCreate(files:$files){
        files{id fileStatus} userErrors{field message}}}""", {"files": files}, mutation=True), "fileCreate")
print(f"  {len(new_files)} uploaded, {len(catalog['theme_files']) - len(new_files)} already present")

# ---------------------------------------------------------------- 2. collections
print("\n2. Collections")
collection_ids = {}
for c in catalog["collections"]:
    found = gql("query($h:String!){collectionByHandle(handle:$h){id}}", {"h": c["handle"]})["collectionByHandle"]
    if found:
        collection_ids[c["handle"]] = found["id"]
        print(f"  exists  {c['handle']}")
        continue
    d = gql("""mutation($input:CollectionInput!){collectionCreate(input:$input){
        collection{id} userErrors{field message}}}""",
        {"input": {"title": c["title"], "handle": c["handle"], "descriptionHtml": c["descriptionHtml"],
                   "image": {"src": stage(c["image"]), "altText": c["title"]}}}, mutation=True)
    collection_ids[c["handle"]] = check(d, "collectionCreate")["collection"]["id"]
    print(f"  created {c['handle']}")

# ---------------------------------------------------------------- 3. products
print("\n3. Products")
product_ids = []
for p in catalog["products"]:
    found = gql("query($h:String!){productByHandle(handle:$h){id}}", {"h": p["handle"]})["productByHandle"]
    if found:
        product_ids.append(found["id"])
        print(f"  exists  {p['handle']}")
        continue
    media = [{"originalSource": stage(i), "mediaContentType": "IMAGE", "alt": p["title"]} for i in p["images"]]
    d = gql("""mutation($product:ProductCreateInput!,$media:[CreateMediaInput!]){
        productCreate(product:$product,media:$media){
          product{id variants(first:1){nodes{id}}} userErrors{field message}}}""",
        {"product": {"title": p["title"], "handle": p["handle"], "descriptionHtml": p["descriptionHtml"],
                     "vendor": VENDOR, "productType": p["productType"], "tags": p["tags"],
                     "status": "ACTIVE" if p["price"] else "DRAFT",
                     "collectionsToJoin": [collection_ids[h] for h in p["collections"]]},
         "media": media}, mutation=True)
    prod = check(d, "productCreate")["product"]
    product_ids.append(prod["id"])
    if p["price"]:
        check(gql("""mutation($pid:ID!,$v:[ProductVariantsBulkInput!]!){
            productVariantsBulkUpdate(productId:$pid,variants:$v){userErrors{field message}}}""",
            {"pid": prod["id"], "v": [{"id": prod["variants"]["nodes"][0]["id"], "price": p["price"]}]},
            mutation=True), "productVariantsBulkUpdate")
    print(f"  created {p['handle']} ({'₱' + p['price'] if p['price'] else 'draft, no price'})")

# ---------------------------------------------------------------- 3b. collection membership for existing products
print("\n3b. Collection membership")
for p in catalog["products"]:
    pid = gql("query($h:String!){productByHandle(handle:$h){id collections(first:50){nodes{handle}}}}", {"h": p["handle"]})["productByHandle"]
    have = {n["handle"] for n in pid["collections"]["nodes"]}
    for h in p["collections"]:
        if h not in have:
            check(gql("""mutation($id:ID!,$pids:[ID!]!){collectionAddProducts(id:$id,productIds:$pids){
                collection{id} userErrors{field message}}}""", {"id": collection_ids[h], "pids": [pid["id"]]},
                mutation=True), "collectionAddProducts")
            print(f"  added {p['handle']} to {h}")

# ---------------------------------------------------------------- 4. publish to Online Store
print("\n4. Publishing to Online Store")
if online_store:
    for gid in list(collection_ids.values()) + product_ids:
        check(gql("""mutation($id:ID!,$input:[PublicationInput!]!){publishablePublish(id:$id,input:$input){
            userErrors{field message}}}""", {"id": gid, "input": [{"publicationId": online_store}]},
            mutation=True), "publishablePublish")
    print(f"  published {len(collection_ids)} collections and {len(product_ids)} products")
else:
    print("  Online Store publication not found; publish from the admin")

# ---------------------------------------------------------------- 5. pages
print("\n5. Pages")
pages = [
    {"title": "About", "handle": "about", "templateSuffix": "about", "body": ""},
    {"title": "Contact", "handle": "contact", "templateSuffix": "contact", "body": ""},
    {"title": "Custom Builds", "handle": "custom-builds", "templateSuffix": "custom-builds", "body": ""},
]
existing_pages = {n["handle"]: n for n in gql("{pages(first:50){nodes{id handle}}}")["pages"]["nodes"]}
for pg in pages:
    if pg["handle"] in existing_pages:
        check(gql("""mutation($id:ID!,$page:PageUpdateInput!){pageUpdate(id:$id,page:$page){
            page{id} userErrors{field message}}}""",
            {"id": existing_pages[pg["handle"]]["id"], "page": {"templateSuffix": pg["templateSuffix"]}},
            mutation=True), "pageUpdate")
        print(f"  updated template on /pages/{pg['handle']}")
    else:
        check(gql("""mutation($page:PageCreateInput!){pageCreate(page:$page){page{id} userErrors{field message}}}""",
            {"page": {**pg, "isPublished": True}}, mutation=True), "pageCreate")
        print(f"  created /pages/{pg['handle']}")

# ---------------------------------------------------------------- 6. main menu
print("\n6. Main menu")
menus = gql("{menus(first:20){nodes{id handle title}}}")["menus"]["nodes"]
main = next((m for m in menus if m["handle"] == "main-menu"), None)
items = [
    {"title": "Shop", "type": "HTTP", "url": "/collections/all", "items": [
        {"title": "Tari Cases", "type": "COLLECTION", "resourceId": collection_ids["tari-cases"]},
        {"title": "Catch Bags", "type": "COLLECTION", "resourceId": collection_ids["catch-bags"]},
        {"title": "Takera", "type": "COLLECTION", "resourceId": collection_ids["takera"]},
        {"title": "Tari Sheaths", "type": "COLLECTION", "resourceId": collection_ids["tari-sheaths"]},
        {"title": "Sharpener Cases", "type": "COLLECTION", "resourceId": collection_ids["sharpener-cases"]},
        {"title": "Arm Protectors", "type": "COLLECTION", "resourceId": collection_ids["arm-protectors"]},
        {"title": "All Accessories", "type": "COLLECTION", "resourceId": collection_ids["accessories"]},
        {"title": "Custom Builds", "type": "COLLECTION", "resourceId": collection_ids["custom-builds"]},
    ]},
    {"title": "Custom Builds", "type": "HTTP", "url": "/pages/custom-builds"},
    {"title": "Tari Cases", "type": "COLLECTION", "resourceId": collection_ids["tari-cases"]},
    {"title": "Catch Bags", "type": "COLLECTION", "resourceId": collection_ids["catch-bags"]},
    {"title": "About", "type": "HTTP", "url": "/pages/about"},
    {"title": "Contact", "type": "HTTP", "url": "/pages/contact"},
]
if main:
    check(gql("""mutation($id:ID!,$title:String!,$items:[MenuItemUpdateInput!]!){
        menuUpdate(id:$id,title:$title,items:$items){menu{id} userErrors{field message}}}""",
        {"id": main["id"], "title": main["title"], "items": items}, mutation=True), "menuUpdate")
    print("  main-menu updated")
else:
    check(gql("""mutation($title:String!,$handle:String!,$items:[MenuItemCreateInput!]!){
        menuCreate(title:$title,handle:$handle,items:$items){menu{id} userErrors{field message}}}""",
        {"title": "Main menu", "handle": "main-menu", "items": items}, mutation=True), "menuCreate")
    print("  main-menu created")

print("\nDone.")

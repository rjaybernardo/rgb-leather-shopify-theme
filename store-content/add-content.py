#!/usr/bin/env python3
"""Second-pass content for RGB LeatherCrafts: extra product photos, product videos,
theme videos and the journal (blog). Safe to re-run; anything already present is skipped.

Run setup-store.py first. Usage: store-content/add-content.py [--store rgb-leather.myshopify.com]
"""
import argparse, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument("--store", default="rgb-leather.myshopify.com")
args = ap.parse_args()
sys.argv = [sys.argv[0], "--store", args.store, "--dry-run"]

# Reuse gql/check/stage helpers from setup-store.py without running its body.
src = open(os.path.join(HERE, "setup-store.py")).read()
helpers = src.split("# ---------------------------------------------------------------- plan / dry run")[0]
exec(compile(helpers, "setup-store.py", "exec"))
content = json.load(open(os.path.join(HERE, "content.json")))
import mimetypes, re, subprocess

VIDEOS = os.path.join(HERE, "videos")


def stage_any(path, resource):
    mime = mimetypes.guess_type(path)[0]
    d = gql("""mutation($input:[StagedUploadInput!]!){stagedUploadsCreate(input:$input){
        stagedTargets{url resourceUrl parameters{name value}} userErrors{field message}}}""",
        {"input": [{"resource": resource, "filename": os.path.basename(path), "mimeType": mime,
                    "httpMethod": "POST", "fileSize": str(os.path.getsize(path))}]}, mutation=True)
    t = check(d, "stagedUploadsCreate")["stagedTargets"][0]
    curl = ["curl", "-sS", "--fail", "-X", "POST", t["url"]]
    for p in t["parameters"]:
        curl += ["-F", f"{p['name']}={p['value']}"]
    curl += ["-F", f"file=@{path}"]
    subprocess.run(curl, check=True, capture_output=True)
    print(f"  uploaded {os.path.basename(path)}")
    return t["resourceUrl"]


UUID_SUFFIX = re.compile(r"_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\.)")


def basename_of(url):
    """Filename without query string or the _<uuid> suffix Shopify adds to duplicate names."""
    return UUID_SUFFIX.sub("", os.path.basename(url.split("?")[0]))


# ---------------------------------------------------------------- 1. product photos & videos
print("1. Product media")
for handle, extra in content["product_media"].items():
    p = gql("""query($h:String!){productByHandle(handle:$h){id media(first:100){nodes{
        ... on MediaImage{image{url}} ... on Video{filename}}}}}""", {"h": handle})["productByHandle"]
    have = set()
    for n in p["media"]["nodes"]:
        if n.get("image"):
            have.add(basename_of(n["image"]["url"]))
        if n.get("filename"):
            have.add(UUID_SUFFIX.sub("", n["filename"]))
    media = []
    for rel in extra.get("images", []):
        if os.path.basename(rel) not in have:
            media.append({"originalSource": stage(rel), "mediaContentType": "IMAGE", "alt": extra["alt"]})
    for v in extra.get("videos", []):
        if v not in have:
            media.append({"originalSource": stage_any(os.path.join(VIDEOS, v), "VIDEO"),
                          "mediaContentType": "VIDEO", "alt": extra["alt"]})
    if media:
        check(gql("""mutation($p:ProductUpdateInput!,$m:[CreateMediaInput!]){productUpdate(product:$p,media:$m){
            product{id} userErrors{field message}}}""", {"p": {"id": p["id"]}, "m": media}, mutation=True), "productUpdate")
    print(f"  {handle}: +{len(media)}")

# ---------------------------------------------------------------- 2. theme videos → Files
print("\n2. Theme videos")
existing = gql("""{files(first:100,query:"media_type:VIDEO"){nodes{... on Video{filename}}}}""")["files"]["nodes"]
have = {n.get("filename") for n in existing}
new = [v for v in content["theme_videos"] if v not in have]
if new:
    check(gql("""mutation($files:[FileCreateInput!]!){fileCreate(files:$files){files{id} userErrors{field message}}}""",
        {"files": [{"originalSource": stage_any(os.path.join(VIDEOS, v), "VIDEO"), "filename": v,
                    "contentType": "VIDEO"} for v in new]}, mutation=True), "fileCreate")
print(f"  {len(new)} uploaded, {len(content['theme_videos']) - len(new)} already present")

# ---------------------------------------------------------------- 3. journal
print("\n3. Journal")
b = content["blog"]
blogs = gql("{blogs(first:20){nodes{id handle}}}")["blogs"]["nodes"]
blog = next((x for x in blogs if x["handle"] == b["handle"]), None)
if not blog:
    blog = check(gql("""mutation($blog:BlogCreateInput!){blogCreate(blog:$blog){blog{id handle} userErrors{field message}}}""",
        {"blog": {"title": b["title"], "handle": b["handle"]}}, mutation=True), "blogCreate")["blog"]
    print(f"  created blog /blogs/{b['handle']}")

# Article images are uploaded to Files so the body can reference their CDN URLs.
needed = sorted({img for a in b["articles"] for img in a["images"]})
FILES_Q = """query($q:String!){files(first:250,query:$q){nodes{fileStatus ... on MediaImage{image{url}}}}}"""
journal_q = {"q": "media_type:IMAGE AND filename:journal-*"}
existing = gql(FILES_Q, journal_q)["files"]["nodes"]
url_of = {basename_of(n["image"]["url"]): n["image"]["url"] for n in existing if n.get("image")}
missing = [i for i in needed if os.path.basename(i) not in url_of]
if missing:
    check(gql("""mutation($files:[FileCreateInput!]!){fileCreate(files:$files){files{id} userErrors{field message}}}""",
        {"files": [{"originalSource": stage(i), "filename": os.path.basename(i), "contentType": "IMAGE",
                    "alt": alt_for(i)} for i in missing]}, mutation=True), "fileCreate")
    for _ in range(30):
        time.sleep(4)
        nodes = gql(FILES_Q, journal_q)["files"]["nodes"]
        url_of = {basename_of(n["image"]["url"]): n["image"]["url"] for n in nodes if n.get("image")}
        if all(os.path.basename(i) in url_of for i in needed):
            break
    else:
        sys.exit("Timed out waiting for article images to process")

articles = {a["handle"] for a in gql("""query($id:ID!){blog(id:$id){articles(first:50){nodes{handle}}}}""",
                                       {"id": blog["id"]})["blog"]["articles"]["nodes"]}
for a in b["articles"]:
    if a["handle"] in articles:
        print(f"  exists  {a['handle']}")
        continue
    body = a["body"]
    for i in a["images"]:
        body = body.replace("{{" + os.path.basename(i) + "}}", url_of[os.path.basename(i)].split("?")[0])
    check(gql("""mutation($article:ArticleCreateInput!){articleCreate(article:$article){article{id} userErrors{field message}}}""",
        {"article": {"blogId": blog["id"], "title": a["title"], "handle": a["handle"], "body": body,
                     "summary": a["summary"], "author": {"name": "RGB LeatherCrafts"}, "tags": a["tags"],
                     "isPublished": True,
                     "image": {"url": url_of[os.path.basename(a["images"][0])].split("?")[0], "altText": a["title"]}}},
        mutation=True), "articleCreate")
    print(f"  created {a['handle']}")

print("\nDone.")

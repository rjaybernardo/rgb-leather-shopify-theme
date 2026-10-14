#!/usr/bin/env python3
"""Brand Shopify's hosted checkout and customer account pages to match the RGB LeatherCrafts theme.

Customer account pages (orders, profile, returns) aren't rendered by the theme; they use the
published checkout profile's branding. This sets the logo, palette, fonts and corner radius there.

Requires: shopify store auth ... --scopes ...,read_checkout_branding_settings,write_checkout_branding_settings
Usage: store-content/brand-accounts.py [--store rgb-leather.myshopify.com]
"""
import argparse, json, subprocess, sys

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
    noise = lambda s: "\n".join(l for l in s.splitlines() if '"type":"progress"' not in l).strip()
    out = r.stdout[r.stdout.find("\n{\n") + 1:] if "\n{\n" in r.stdout else r.stdout
    if r.returncode != 0 or not out.strip().startswith("{"):
        sys.exit(f"shopify store execute failed (exit {r.returncode}):\n{noise(r.stdout)}\n{noise(r.stderr)}")
    return json.loads(out)


# Theme palette (config/settings_data.json, scheme-1 cream / scheme-2 white)
CREAM, WHITE, ESPRESSO, COGNAC, BORDER = "#F7F3EE", "#FFFFFF", "#1E1915", "#9B5B2C", "#E3D9CE"

profile = next(p for p in gql("{checkoutProfiles(first:10){nodes{id name isPublished}}}")["checkoutProfiles"]["nodes"]
               if p["isPublished"])
logo = gql("""{files(first:5,query:"filename:rgb-leathercrafts-logo.png"){nodes{id ... on MediaImage{image{url}}}}}""")
logo = next(n for n in logo["files"]["nodes"] if "logo-light" not in n["image"]["url"])
print(f"Profile: {profile['name']}  Logo: {logo['id']}")

branding = {
    "designSystem": {
        "colors": {
            "schemes": {
                "scheme1": {  # page background
                    "base": {"background": CREAM, "text": ESPRESSO, "accent": COGNAC},
                    "control": {"background": WHITE, "border": BORDER, "text": ESPRESSO, "accent": COGNAC},
                    "primaryButton": {"background": ESPRESSO, "text": WHITE, "accent": COGNAC,
                                      "hover": {"background": COGNAC, "text": WHITE}},
                    "secondaryButton": {"background": CREAM, "text": ESPRESSO, "border": ESPRESSO,
                                        "hover": {"background": ESPRESSO, "text": WHITE}},
                },
                "scheme2": {  # cards / order summary
                    "base": {"background": WHITE, "text": ESPRESSO, "accent": COGNAC},
                    "control": {"background": CREAM, "border": BORDER, "text": ESPRESSO, "accent": COGNAC},
                    "primaryButton": {"background": ESPRESSO, "text": WHITE, "accent": COGNAC,
                                      "hover": {"background": COGNAC, "text": WHITE}},
                },
            },
        },
        "cornerRadius": {"small": 2, "base": 4, "large": 8},
        "typography": {
            "primary": {"shopifyFontGroup": {"name": "Assistant"}},
            "secondary": {"shopifyFontGroup": {"name": "Playfair Display"}},
            "size": {"base": 15.0, "ratio": 1.25},
        },
    },
    "customizations": {
        "header": {"logo": {"image": {"mediaImageId": logo["id"]}, "maxWidth": 220}, "colorScheme": "COLOR_SCHEME1"},
        "main": {"colorScheme": "COLOR_SCHEME1"},
        "orderSummary": {"colorScheme": "COLOR_SCHEME2"},
        "headingLevel1": {"typography": {"font": "SECONDARY", "weight": "BASE"}},
        "headingLevel2": {"typography": {"font": "SECONDARY", "weight": "BASE"}},
        "headingLevel3": {"typography": {"font": "PRIMARY", "weight": "BOLD"}},
        "primaryButton": {"cornerRadius": "BASE", "typography": {"weight": "BOLD"}},
        "control": {"cornerRadius": "BASE", "border": "FULL"},
    },
}

d = gql("""mutation($id:ID!,$input:CheckoutBrandingInput!){checkoutBrandingUpsert(checkoutProfileId:$id,checkoutBrandingInput:$input){
    checkoutBranding{designSystem{typography{primary{name} secondary{name}}}} userErrors{field message}}}""",
        {"id": profile["id"], "input": branding}, mutation=True)["checkoutBrandingUpsert"]
if d["userErrors"]:
    sys.exit(f"checkoutBrandingUpsert failed: {json.dumps(d['userErrors'], indent=2)}")
t = d["checkoutBranding"]["designSystem"]["typography"]
print(f"Branding applied: headings {t['secondary']['name']}, body {t['primary']['name']}, logo, cream/espresso/cognac palette")

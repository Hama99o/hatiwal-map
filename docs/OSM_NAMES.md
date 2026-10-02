# Adding Pashto, Dari and English names to the map

The street and place names in the Hatiwal map come from **OpenStreetMap (OSM)**, the free map
anyone can edit. If a street shows in the wrong language, or shows no name at all, the fix is to
add the name in OSM. Hatiwal picks it up automatically.

Why this matters: measured on 2026-10-02, the central Kabul map tile had **4 named streets, and
none of them had a Pashto or Dari name**. Herat's had none at all. Every name you add makes the map
better for every Hatiwal user, and for everyone else who uses OSM.

---

## 1. Create an account (once)

1. Go to <https://www.openstreetmap.org> and click **Sign Up**.
2. Confirm your email.
3. Optional but helpful: on your profile page, set the languages you know. That tells other
   mappers you can check Pashto or Dari names.

## 2. Add a name with the iD editor

1. On openstreetmap.org, zoom to the street or place, then click **Edit** (top left). This opens
   the iD editor in your browser.
2. Click the street (or the place, park, mosque or shop).
3. In the left panel, find **Name**. The main `name` is what is written on the ground, usually in
   the local language. **Do not replace it.**
4. Click the **+** next to Name to add another language, choose the language, and type the name:
   - Pashto: `ps`
   - Dari / Persian: `fa`
   - English: `en`
   - Urdu: `ur`
5. Click **Save** (top right), write a short comment such as
   `Added Pashto and Dari names for Maiwand Road`, and upload.

Prefer typing tags directly? Open **Tags → text view** and add lines as in §3.

## 3. What the tags look like

A main road in Kabul (it appears in the Hatiwal preview as «میوند واټ»):

```
highway=primary
name=میوند واټ
name:ps=میوند واټ
name:fa=جادهٔ میوند
name:en=Maiwand Road
```

A district label:

```
place=suburb
name=ناحیه دوم
name:fa=ناحیه دوم
name:ps=دوهمه ناحیه
name:en=District 2
```

A park:

```
leisure=park
name=پارک شهر نو
name:fa=پارک شهر نو
name:ps=د ښار نو پارک
name:en=Shahr-e Naw Park
```

Tips:
- Use the name people actually use, and spell it the normal way, with proper Pashto letters (ټ ډ ړ
  ښ ږ ګ ڼ ې ۍ). Don't write Pashto with Persian approximations.
- `name:en` should be a real English or common romanised name ("Maiwand Road"), not a letter-by-letter
  transliteration.
- One street is often split into several pieces in OSM. Add the name to each piece. iD lets you
  select several pieces with Shift-click and edit them together.

## 4. The rule you must not break: no copying

**Never copy names from Google Maps, Apple Maps, Bing Maps, Yandex or any other map or app.**
Their data is copyrighted. Copying it into OSM is a licence violation, and OSM removes such edits.
Repeated copying can get the account blocked, and the names can also be deleted from everyone's
map, Hatiwal's included.

Allowed sources:
- your own local knowledge, and what people in the area call it;
- street signs and shop signs you have seen or photographed yourself;
- official signage or government sources that allow re-use.

Satellite imagery available *inside* the iD editor may be used for tracing shapes. It never
provides names.

## 5. When the names appear in Hatiwal

Hatiwal rebuilds its map from OSM **once a month** (1st of the month, 02:00 UTC). After that
rebuild, every Hatiwal app and the website show the new names at once, with no app update.
Edits made just before the 1st may land in the following month's rebuild, because the source
extracts lag OSM by about a day.

How Hatiwal chooses which name to show (v2 map styles):

| App language | Order tried |
|---|---|
| Pashto | `name:ps` → `name:fa` → local name in Arabic script → `name:en` → `name` |
| Dari | `name:fa` → `name:ps` → local name in Arabic script → `name:en` → `name` |
| Urdu | `name:ur` → `name:fa` → local name in Arabic script → `name:en` → `name` |
| English | `name:en` → `name` |

So adding **both** `name:ps` and `name:fa` gives each reader their own language. Adding either one
alone already helps both, because each is the other's fallback.

## 6. Good manners

- Edit by hand, a few streets at a time. Bulk or automated edits need approval from the OSM
  community first (<https://wiki.openstreetmap.org/wiki/Automated_Edits_code_of_conduct>).
- If someone comments on your changeset, answer politely. OSM is a community.
- Help and questions: the OSM Afghanistan community page,
  <https://wiki.openstreetmap.org/wiki/Afghanistan>.

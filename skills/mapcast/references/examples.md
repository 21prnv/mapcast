# Request to scene: worked examples

Each request below is followed by the scene to write. Copy the closest one and adjust.
Every scene here is checked by `npm test`.

## 1. "Show India on a map"
```json
{ "highlights": [{ "country": "India" }] }
```

## 2. "Highlight Brazil in green and mark the capital"
```json
{ "highlights": [{ "country": "Brazil", "color": "green", "capital": true }] }
```

## 3. "France with its flag, cinematic, for an Instagram post"
```json
{
  "aspect": "4:5",
  "effects": { "grid": true, "blur": 0.7, "grade": "muted" },
  "highlights": [{ "country": "France", "style": "flag", "labelAnim": "spread" }]
}
```

## 4. "The US in yellow with the rest of the world greyed out"
```json
{ "highlights": [{ "country": "United States", "style": "highlight", "color": "yellow" }] }
```

## 5. "A YouTube Short zooming into Japan from space"
```json
{ "aspect": "9:16", "duration": 6, "camera": "zoom-in", "highlights": [{ "country": "Japan" }] }
```

## 6. "Old parchment map of the Roman heartland: Italy, with Rome marked"
```json
{
  "basemap": "paper",
  "highlights": [{ "country": "Italy", "capital": true, "labelAnim": "type" }]
}
```

## 7. "Compare France, Germany and Spain"
```json
{ "highlights": [{ "country": "France" }, { "country": "Germany" }, { "country": "Spain" }] }
```

## 8. "India vs Pakistan, India in saffron and Pakistan in green, neutral borders"
```json
{
  "pov": "default",
  "highlights": [
    { "country": "India", "color": "#ff9933" },
    { "country": "Pakistan", "color": "#01411c" }
  ]
}
```

## 9. "Just the outline of Australia, glowing cyan, no text"
```json
{
  "highlights": [{
    "country": "Australia", "style": "outline", "label": false,
    "border": { "color": "#38e1ff", "width": 4, "glow": 1.2 }
  }]
}
```

## 10. "GDP of the G7 as a heat map" (numbers given by the user)
```json
{
  "camera": "static",
  "data": {
    "title": "GDP 2024 (trillion US$)", "prefix": "$", "unit": "T", "scheme": "heat",
    "values": { "United States": 29.2, "Japan": 4.1, "Germany": 4.7, "United Kingdom": 3.6, "France": 3.2, "Italy": 2.4, "Canada": 2.2 }
  }
}
```

## 11. "Population of South Asia, blue scale, show each country's number"
```json
{
  "effects": { "borders": true },
  "data": {
    "title": "Population (millions)", "unit": "M", "scheme": "blues", "labels": "both",
    "values": { "India": 1441, "Pakistan": 245, "Bangladesh": 173, "Nepal": 31, "Sri Lanka": 22 }
  }
}
```

## 12. "Egypt on an old map, zooming in from far away"
```json
{ "basemap": "paper", "camera": "zoom-in", "duration": 6, "highlights": [{ "country": "Egypt", "capital": true }] }
```

## 13. "Show Mumbai on the map of India"
```json
{ "highlights": [{ "country": "India", "capital": "Mumbai" }] }
```

## 14. "A still image of Canada in red for a thumbnail"
Render to `.png` or `.jpg`; the still shows the final frame.
```json
{ "highlights": [{ "country": "Canada", "color": "red" }] }
```

## 15. "Nigeria, label pops in, static camera, 3 seconds"
```json
{ "duration": 3, "camera": "static", "highlights": [{ "country": "Nigeria", "labelAnim": "pop" }] }
```

## 16. "Mexico highlighted, show neighbouring borders and a sea grid"
```json
{ "effects": { "borders": true, "grid": true }, "highlights": [{ "country": "Mexico", "color": "teal" }] }
```

## 17. "Black and white map with Germany in red"
```json
{ "effects": { "grade": "mono" }, "highlights": [{ "country": "Germany", "color": "red" }] }
```

## 18. "Ukraine with its flag, label 'UKRAINE 2014', vertical"
```json
{ "aspect": "9:16", "highlights": [{ "country": "Ukraine", "style": "flag", "label": "UKRAINE 2014" }] }
```

## 19. "The Nordic countries one after another, each a second apart"
```json
{
  "duration": 7,
  "highlights": [
    { "country": "Norway", "start": 0.5 },
    { "country": "Sweden", "start": 1.5 },
    { "country": "Finland", "start": 2.5 },
    { "country": "Denmark", "start": 3.5 },
    { "country": "Iceland", "start": 4.5 }
  ]
}
```

## 20. "Square video of South Africa in gold with Cape Town marked, serif label"
```json
{
  "aspect": "1:1",
  "highlights": [{ "country": "South Africa", "color": "gold", "capital": "Cape Town", "labelFont": "serif" }]
}
```

## 21. "Colour these by unemployment rate: Spain 11.4, Greece 9.8, Germany 3.4 (percent, 2024)"
High is bad, so a red scale; show the numbers.
```json
{
  "data": {
    "title": "Unemployment rate, 2024", "unit": "%", "scheme": "reds", "labels": "both",
    "values": { "Spain": 11.4, "Greece": 9.8, "Germany": 3.4 }
  }
}
```

## 22. "Turkey on an old map with Istanbul marked, zooming in"
Istanbul is not the capital (Ankara is), so name the city.
```json
{ "basemap": "paper", "camera": "zoom-in", "highlights": [{ "country": "Turkey", "capital": "Istanbul" }] }
```

## Requests to decline or redirect

- "Highlight California" / "Show the state of Kerala": states and provinces are not supported yet. Offer the country.
- "Draw a route from Delhi to London": routes are not supported yet.
- "Colour Africa by GDP" with no numbers: ask for the figures or offer to look them up and cite the source.

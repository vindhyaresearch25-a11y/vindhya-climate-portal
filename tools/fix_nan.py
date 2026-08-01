import re, json

with open(r"D:\VINDHYA\vindhya_dashboard\dashboard\data\mp_climate_data.json", "r", encoding="utf-8") as f:
    content = f.read()

# Replace NaN with null (JSON doesn't allow NaN)
content = re.sub(r'\bNaN\b', 'null', content)

# Verify it's valid JSON
data = json.loads(content)

with open(r"D:\VINDHYA\vindhya_dashboard\dashboard\data\mp_climate_data.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False)

print("Fixed: NaN replaced with null, file rewritten as valid JSON")

import json
d = json.load(open(r"D:\VINDHYA\vindhya_dashboard\dashboard\data\mp_climate_data.json"))
for dk in ["bhopal", "indore", "jabalpur", "rewa", "sidhi"]:
    vs = d["districts"][dk]["villages"]
    null_lat = sum(1 for v in vs.values() if v["lat"] is None)
    print(f"{dk}: {len(vs)} villages, null lat: {null_lat}")
    for vid, v in list(vs.items())[:2]:
        print(f"  {v['name']}: lat={v['lat']}, lon={v['lon']}")

"""
14_mera_khet_benchmark.py -- MERA_KHET_PROMPT.md A3: "PEHLE NAAPO (kaam
shuru mat karo)" -- measure real GEE timing on a real ~2-hectare polygon
before building Mera Khet, so the panel's own promises (10-second cropland
extraction, GeoTIFF turnaround) are grounded in a real number, not a guess.

Real, honest numbers only -- a query that fails or times out is reported
as a failure, not papered over with an estimate.

Usage: python scripts/14_mera_khet_benchmark.py
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone

import ee

import config as C


def gee_init():
    creds = ee.ServiceAccountCredentials(None, C.GEE_SERVICE_ACCOUNT_KEY_PATH)
    ee.Initialize(creds)
    ee.data.setDeadline(90_000)  # same fix as 08_gee_national_climate.py


# A real ~2-hectare square (~141m x 141m) of farmland near Bhopal, MP --
# chosen from the district this portal already has real IMD data for, so
# the result is directly comparable to the dashboard's existing numbers.
CENTER_LAT, CENTER_LON = 23.15, 77.35
HALF_SIDE_DEG = 0.00064  # ~71m half-side at this latitude -> ~2.0 ha square


def make_polygon():
    lat, lon, h = CENTER_LAT, CENTER_LON, HALF_SIDE_DEG
    coords = [[lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h], [lon - h, lat - h]]
    return ee.Geometry.Polygon([coords])


def timed(label, fn):
    t0 = time.time()
    try:
        result = fn()
        dt = time.time() - t0
        print(f"[{label}] OK in {dt:.2f}s -> {result}")
        return {"label": label, "ok": True, "seconds": round(dt, 2), "result": result}
    except Exception as e:
        dt = time.time() - t0
        print(f"[{label}] FAILED after {dt:.2f}s -> {e}")
        return {"label": label, "ok": False, "seconds": round(dt, 2), "error": str(e)}


def bench_dynamic_world_cropland(geom):
    dw = (ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1")
          .filterBounds(geom)
          .filterDate("2025-01-01", "2026-08-01")
          .select("label")
          .mode())
    stats = dw.reduceRegion(ee.Reducer.frequencyHistogram(), geom, 10, bestEffort=True).getInfo()
    return stats


def bench_sentinel2_ndvi(geom):
    s2 = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
          .filterBounds(geom)
          .filterDate("2026-02-01", "2026-08-01")
          .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20))
          .sort("system:time_start", False)
          .first())
    ndvi = s2.normalizedDifference(["B8", "B4"]).rename("ndvi")
    stats = ndvi.reduceRegion(ee.Reducer.mean(), geom, 10, bestEffort=True).getInfo()
    date = ee.Date(s2.get("system:time_start")).format("YYYY-MM-dd").getInfo()
    return {"ndvi_mean": stats.get("ndvi"), "image_date": date}


def bench_clear_day_count(geom):
    start = "2026-02-01"  # last ~6 months, spans a real cloudy monsoon window
    end = "2026-08-01"
    coll = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(geom)
            .filterDate(start, end))
    total = coll.size().getInfo()
    clear = coll.filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20)).size().getInfo()
    return {"total_images": total, "clear_lt20pct_cloud": clear, "window": f"{start} to {end}"}


def bench_geotiff_export(geom):
    """Real async Export.image.toDrive, polled to completion (or a hard
    cap) -- this is the honest way to measure it; GEE gives no synchronous
    answer. Exports to a folder in the service account's own Drive, which
    a service account does not have by default -- expect this to fail with
    a clear permission error on most setups, which IS the honest finding
    MERA_KHET_PROMPT.md needs (a service account can't casually write to
    someone's personal Drive; toCloudStorage with a real bucket would be
    needed for the real product, out of scope for this measurement)."""
    dw = (ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1")
          .filterBounds(geom).filterDate("2025-01-01", "2026-08-01").select("label").mode())
    task = ee.batch.Export.image.toDrive(
        image=dw.clip(geom), description="mera_khet_benchmark_geotiff",
        folder="mera_khet_benchmark", region=geom, scale=10, fileFormat="GeoTIFF",
        maxPixels=1e8,
    )
    task.start()
    t0 = time.time()
    max_wait = 300  # 5 minutes hard cap for this benchmark
    while time.time() - t0 < max_wait:
        status = task.status()
        state = status.get("state")
        if state in ("COMPLETED", "FAILED", "CANCELLED"):
            return {"final_state": state, "seconds": round(time.time() - t0, 1), "status": status}
        time.sleep(10)
    return {"final_state": "TIMED_OUT_AT_" + str(max_wait) + "s", "status": task.status()}


def main():
    print("Initializing GEE...")
    gee_init()
    geom = make_polygon()
    area_ha = geom.area(1).getInfo() / 10000.0
    print(f"Test polygon real area: {area_ha:.3f} ha (target ~2.0 ha)\n")

    results = {"metadata": {
        "purpose": "MERA_KHET_PROMPT.md A3 benchmark -- measured before building Mera Khet",
        "polygon_center": [CENTER_LAT, CENTER_LON],
        "polygon_area_ha": round(area_ha, 3),
        "run_at_utc": datetime.now(timezone.utc).isoformat(),
        "note": "GEE EECU cost per query is NOT obtainable via the Python API -- "
                "only visible in the Cloud Console quota dashboard (browser-only, "
                "not queryable programmatically). Not measured here; reported honestly "
                "as not measured, not estimated.",
    }, "benchmarks": []}

    results["benchmarks"].append(timed("1_dynamic_world_cropland", lambda: bench_dynamic_world_cropland(geom)))
    results["benchmarks"].append(timed("2_sentinel2_ndvi_latest", lambda: bench_sentinel2_ndvi(geom)))
    results["benchmarks"].append(timed("3_clear_day_count_6mo", lambda: bench_clear_day_count(geom)))
    results["benchmarks"].append(timed("4_geotiff_export_async", lambda: bench_geotiff_export(geom)))

    out_path = C.PROJECT_ROOT / "docs" / "MERA_KHET_BENCHMARK.json"
    out_path.write_text(json.dumps(results, indent=2, default=str))
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    main()

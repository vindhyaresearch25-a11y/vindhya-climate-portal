@echo off
cd /d %~dp0

echo ============================================================
echo  VILLAGE-LEVEL PIPELINE for 5 MP districts
echo  This will take 15-30 minutes for ~5000+ villages
echo ============================================================
echo.

REM Delete old district-level cache if present
if exist ..\outputs\cache\tmax_district_daily.csv del ..\outputs\cache\tmax_district_daily.csv
if exist ..\outputs\cache\tmin_district_daily.csv del ..\outputs\cache\tmin_district_daily.csv
if exist ..\outputs\cache\precip_district_daily.csv del ..\outputs\cache\precip_district_daily.csv

echo === [1/4] extracting per-village daily timeseries ===
python 01_extract_village_timeseries.py
if errorlevel 1 goto :err

echo.
echo === [2/4] computing per-village indices ===
python 02_compute_indices.py
if errorlevel 1 goto :err

echo.
echo === [3/4] building chart data ===
python 03_build_chart_data.py
if errorlevel 1 goto :err

echo.
echo === [4/4] assembling dashboard JSON ===
python 04_build_dashboard_json.py
if errorlevel 1 goto :err

echo.
echo ============================================================
echo  DONE. Output:
echo    ..\dashboard\data\mp_climate_data.json
echo.
echo  To view dashboard:
echo    cd ..\dashboard
echo    python -m http.server 8000
echo  Then open http://localhost:8000 in your browser.
echo ============================================================
goto :eof

:err
echo.
echo *** PIPELINE FAILED. See error above. ***
exit /b 1

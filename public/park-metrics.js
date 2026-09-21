/* Friendly park metric labels shared by the web player and its Node tests.
 * Keep thresholds and formatting aligned with Android ParkInfoScreen.kt. */
(function exposeParkMetrics(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ParkMetrics = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createParkMetrics() {
  'use strict';

  const COLORS = Object.freeze({
    good: '#2E7D32', blue: '#1565C0', amber: '#9A6200', orange: '#E65100',
    red: '#C62828', deepRed: '#8E1B1B', neutral: '#52606D',
  });

  const number = (values, key) => {
    const value = Number(values && values[key]);
    return Number.isFinite(value) ? value : null;
  };
  const fixed = (value, digits) => value == null ? '' : value.toFixed(digits);
  const display = (label, status, value, icon, color) => ({ label, status, value, icon, color });

  function temperature(values) {
    const measured = number(values, 'temperature');
    const rawHeatIndex = number(values, 'heat_index');
    const heatIndex = rawHeatIndex == null ? null : (rawHeatIndex > 100 ? rawHeatIndex / 10 : rawHeatIndex);
    const reportedRisk = number(values, 'heat_risk_level');
    const risk = reportedRisk == null ? (
      heatIndex == null || heatIndex < 26.7 ? 0 :
      heatIndex < 32.2 ? 1 : heatIndex < 40.6 ? 2 : heatIndex < 54.4 ? 3 : 4
    ) : Math.round(reportedRisk);
    const state = risk === 1 ? ['體感偏熱', COLORS.amber]
      : risk === 2 ? ['體感炎熱', COLORS.orange]
        : risk === 3 ? ['體感酷熱', COLORS.red]
          : risk === 4 ? ['高溫危險', COLORS.deepRed]
            : ['體感舒適', COLORS.good];
    let value = measured == null ? '–' : `${fixed(measured, 1)}°C`;
    if (heatIndex != null) value += ` / 體感${fixed(heatIndex, 1)}°C`;
    return display('溫度', state[0], value, 'device_thermostat', state[1]);
  }

  function humidity(values) {
    const value = number(values, 'humidity');
    const state = value == null ? ['無資料', COLORS.neutral]
      : value < 40 ? ['乾燥', COLORS.amber]
        : value < 60 ? ['舒適', COLORS.good]
          : value < 75 ? ['偏濕', COLORS.blue]
            : value < 85 ? ['潮濕', COLORS.blue]
              : ['非常潮濕', COLORS.orange];
    return display('濕度', state[0], value == null ? '–' : `${fixed(value, 0)}%`, 'water_drop', state[1]);
  }

  function pm25(values) {
    const value = number(values, 'pm25');
    const state = value == null ? ['無資料', COLORS.neutral]
      : value <= 12.4 ? ['空氣良好', COLORS.good]
        : value <= 30.4 ? ['空氣普通', COLORS.amber]
          : value <= 50.4 ? ['敏感族群注意', COLORS.orange]
            : value <= 125.4 ? ['空氣不佳', COLORS.red]
              : ['空氣很差', COLORS.deepRed];
    return display('PM2.5', state[0], value == null ? '–' : `${fixed(value, 0)} μg/m³`, 'air', state[1]);
  }

  function rainfall(values) {
    const value = number(values, 'hourly_rainfall');
    const state = value == null ? ['無資料', COLORS.neutral]
      : value <= 0 ? ['目前無雨', COLORS.good]
        : value < 10 ? ['小雨', COLORS.blue]
          : value < 20 ? ['有雨', COLORS.blue]
            : value < 40 ? ['雨勢明顯', COLORS.orange]
              : ['大雨注意', COLORS.red];
    return display('雨勢', state[0], value == null ? '–' : `${fixed(value, 1)} mm/h`, 'umbrella', state[1]);
  }

  return Object.freeze({
    COLORS,
    build(values) { return [temperature(values), humidity(values), pm25(values), rainfall(values)]; },
  });
}));

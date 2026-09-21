'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { build } = require('../public/park-metrics');

const byLabel = (values) => Object.fromEntries(build(values).map(metric => [metric.label, metric]));

test('web park metrics match the Android friendly labels and value formats', () => {
  const metrics = byLabel({ temperature: 31.5, heat_index: 394, humidity: 80, pm25: 15, hourly_rainfall: 12 });
  assert.deepEqual(
    Object.fromEntries(Object.entries(metrics).map(([label, metric]) => [label, [metric.status, metric.value, metric.icon, metric.color]])),
    {
      溫度: ['體感炎熱', '31.5°C / 體感39.4°C', 'device_thermostat', '#E65100'],
      濕度: ['潮濕', '80%', 'water_drop', '#1565C0'],
      'PM2.5': ['空氣普通', '15 μg/m³', 'air', '#9A6200'],
      雨勢: ['有雨', '12.0 mm/h', 'umbrella', '#1565C0'],
    },
  );
});

test('reported heat risk wins and boundary states stay aligned', () => {
  assert.equal(byLabel({ heat_index: 25, heat_risk_level: 4 }).溫度.status, '高溫危險');
  assert.equal(byLabel({ humidity: 40 }).濕度.status, '舒適');
  assert.equal(byLabel({ humidity: 85 }).濕度.status, '非常潮濕');
  assert.equal(byLabel({ pm25: 12.4 })['PM2.5'].status, '空氣良好');
  assert.equal(byLabel({ pm25: 125.5 })['PM2.5'].status, '空氣很差');
  assert.equal(byLabel({ hourly_rainfall: 0 }).雨勢.status, '目前無雨');
  assert.equal(byLabel({ hourly_rainfall: 40 }).雨勢.status, '大雨注意');
});

test('missing sensor values have explicit neutral output', () => {
  const metrics = byLabel({});
  assert.equal(metrics.濕度.status, '無資料');
  assert.equal(metrics['PM2.5'].value, '–');
  assert.equal(metrics.雨勢.status, '無資料');
});

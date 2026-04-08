"use strict";

var reg = require("../src/schema_registry.js");
require("../src/schema_definitions_builtin.js");
var ais = require("../src/dataset_modules/ais_module.js");

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

function ok(cond, msg) {
  if (!cond) fail(msg);
  console.log("PASS:", msg);
}

var schema = reg.getSchema("ais_trajectory");
ok(!!schema, "AIS schema is registered");

var outputs = reg.getOutputKeys("ais_trajectory");
ok(Array.isArray(outputs) && outputs.length === 1 && outputs[0].key === "position", "AIS schema exposes position output");

var featureNodes = (((schema || {}).model || {}).metadata || {}).featureNodes || {};
var palette = ((featureNodes.palette || {}).items) || [];
var paletteTypes = palette.map(function (item) { return item.type; });
ok(paletteTypes.indexOf("transformer_block") >= 0, "AIS palette includes transformer block");
ok(paletteTypes.indexOf("reshape") >= 0, "AIS palette includes reshape");
ok(featureNodes.policy && featureNodes.policy.allowHistory === false, "AIS schema disables unsupported history nodes");

ok(ais && typeof ais.build === "function", "AIS dataset module has build()");
ok(ais && ais.playgroundApi && typeof ais.playgroundApi.renderDataset === "function", "AIS dataset module has renderDataset()");
ok(ais && ais.playgroundApi && typeof ais.playgroundApi.renderPlayground === "function", "AIS dataset module has renderPlayground()");


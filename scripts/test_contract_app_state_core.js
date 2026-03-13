"use strict";
var assert = require("assert");
var ASC = require("../src/app_state_core.js");

function main() {
  assert(ASC, "module loaded");
  assert.strictEqual(typeof ASC.create, "function");

  var state = ASC.create({ defaultSchemaId: "mnist", defaultTab: "dataset" });

  // --- initial state ---
  assert.strictEqual(state.getActiveSchema(), "mnist");
  assert.strictEqual(state.getActiveTab(), "dataset");
  assert.strictEqual(state.getActiveDataset(), "");
  assert.strictEqual(state.getActiveModel(), "");

  // --- set/get ---
  state.setActiveDataset("ds_123");
  assert.strictEqual(state.getActiveDataset(), "ds_123");

  state.setActiveModel("m_456");
  assert.strictEqual(state.getActiveModel(), "m_456");

  state.setActiveTrainer("t_789");
  assert.strictEqual(state.getActiveTrainer(), "t_789");

  // --- schema change ---
  state.setActiveSchema("oscillator");
  assert.strictEqual(state.getActiveSchema(), "oscillator");
  assert.strictEqual(state.get("modelSchemaId"), "oscillator");

  // --- subscribe ---
  var notified = [];
  var subId = state.subscribe("activeTab", function (s, path) {
    notified.push({ path: path, value: s.activeTab });
  });
  state.setActiveTab("model");
  assert.strictEqual(notified.length, 1);
  assert.strictEqual(notified[0].path, "activeTab");
  assert.strictEqual(notified[0].value, "model");

  // no notify if same value
  state.setActiveTab("model");
  assert.strictEqual(notified.length, 1, "no duplicate notify");

  // notify on change
  state.setActiveTab("trainer");
  assert.strictEqual(notified.length, 2);

  // --- wildcard subscribe ---
  var allNotified = [];
  state.subscribe("*", function (s, path) {
    allNotified.push(path);
  });
  state.setActiveDataset("ds_new");
  assert(allNotified.indexOf("activeDatasetId") >= 0, "wildcard catches dataset change");

  // --- unsubscribe ---
  state.unsubscribe(subId);
  notified.length = 0;
  state.setActiveTab("evaluation");
  assert.strictEqual(notified.length, 0, "unsubscribed");

  // --- snapshot ---
  var snap = state.getSnapshot();
  assert.strictEqual(snap.activeTab, "evaluation");
  assert.strictEqual(snap.activeDatasetId, "ds_new");
  assert.strictEqual(snap.activeSchemaId, "oscillator");

  // snapshot is a copy
  snap.activeTab = "MODIFIED";
  assert.strictEqual(state.getActiveTab(), "evaluation", "snapshot is immutable copy");

  // --- generic set/get ---
  state.set("customField", 42);
  assert.strictEqual(state.get("customField"), 42);

  console.log("PASS test_contract_app_state_core");
}

main();

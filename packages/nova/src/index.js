// Nova framework — public API
const { buildRoutes, matchRoute } = require("./router");
const { renderPage, wrapHtmlShell, injectStyle, postProcess } = require("./renderer");
const { createDevServer } = require("./server");
const { buildSite } = require("./builder");
const { island, renderIsland, extractIslandIds, injectIslandScripts } = require("./island");
const { signal, computed, effect, untracked, batch, isSignal, isComputed, isReactive } = require("./signals");
const { parseTemplate, compileTemplate, renderTemplate } = require("./template");
const { Injectable, Inject, InjectionToken, Container, rootContainer } = require("./di");
const { scanForIslands, generateIslandEntry, generateManifest, bundleIslands, bundleIsland } = require("./island-bundler");

module.exports = {
  buildRoutes,
  matchRoute,
  renderPage,
  wrapHtmlShell,
  injectStyle,
  postProcess,
  createDevServer,
  buildSite,
  island,
  renderIsland,
  extractIslandIds,
  injectIslandScripts,
  signal,
  computed,
  effect,
  untracked,
  batch,
  isSignal,
  isComputed,
  isReactive,
  parseTemplate,
  compileTemplate,
  renderTemplate,
  Injectable,
  Inject,
  InjectionToken,
  Container,
  rootContainer,
  scanForIslands,
  generateIslandEntry,
  generateManifest,
  bundleIslands,
  bundleIsland,
};

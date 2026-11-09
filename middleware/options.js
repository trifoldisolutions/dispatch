const express = require("express");

// OPTIONS, as it was when these routes sat directly on the app: one answer after
// all of them, naming the methods of every route on that path. A mounted router
// answers it itself with only its own routes' methods, so /:name/:section would
// answer for /api/registry and leave out its PUT. So these routers are mounted
// through skipOptions, and answerOptions, mounted last, answers for them from
// their router.routes lists.
function skipOptions(router) {
  return (req, res, next) => (req.method === "OPTIONS" ? next() : router(req, res, next));
}

function answerOptions(facades) {
  const routes = express.Router();
  const pass = (req, res, next) => next();
  for (const { mount, router } of facades) {
    for (const { method, path } of router.routes) routes[method.toLowerCase()]((mount === "/" ? "" : mount) + path, pass);
  }
  return (req, res, next) => (req.method === "OPTIONS" ? routes(req, res, next) : next());
}

module.exports = { skipOptions, answerOptions };

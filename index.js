'use strict';

const fs = require('fs');
const pify = require('pify');
const got = require('got');
const postcss = require('postcss');
const isAbsoluteUrl = require('is-absolute-url');
const postcssUrl = require('postcss-url');

const SOURCE_MAP_INLINE = 'inline';
const SOURCE_MAP_FILE = 'file';

const urlCache = new Map();

function clearCache() {
  urlCache.clear();
}

function concat({
  stylesheets,
  output,
  sourceMap = SOURCE_MAP_INLINE,
  plugins = []
}) {
  if (stylesheets.length === 0) {
    return Promise.reject(new Error('No stylesheets provided'));
  }

  const allPlugins = [
    // Copy all url-referenced assets to the same place as the CSS.
    postcssUrl({
      url: 'copy',
      assetsPath: './',
      useHash: true,
      hashOptions: {
        append: true
      }
    }),
    ...plugins
  ].filter(Boolean);

  const writeOutput = (root) => {
    return postcss(allPlugins)
      .process(root, {
        from: undefined,
        to: output,
        map: {
          inline: sourceMap === SOURCE_MAP_INLINE
        }
      })
      .then((result) => {
        const promises = [pify(fs.writeFile)(output, result.css)];
        if (sourceMap === SOURCE_MAP_FILE) {
          promises.push(pify(fs.writeFile)(`${output}.map`, result.map));
        }
        return Promise.all(promises);
      })
      .then(() => {});
  };

  return parseStylesheetList(stylesheets).then(writeOutput);
}

function parseStylesheetList(stylesheets) {
  const roots = [];
  const promises = stylesheets.map((source, index) => {
    const parsePromise = isAbsoluteUrl(source)
      ? parseStylesheetFromUrl(source)
      : parseStylesheetFromFs(source);
    return parsePromise.then((root) => {
      roots[index] = root;
    });
  });
  return Promise.all(promises).then(() => concatRoots(roots));
}

function parseStylesheet(css, from) {
  try {
    return postcss.parse(css, { from });
  } catch (error) {
    rethrowPostcssError(error);
  }
}

function parseStylesheetFromUrl(url) {
  const cached = urlCache.get(url);
  if (cached) {
    return Promise.resolve(cached);
  }

  return got(url).then((response) => {
    const css = response.body;
    const root = parseStylesheet(css, url);
    urlCache.set(url, root);
    return root;
  });
}

function parseStylesheetFromFs(filename) {
  return pify(fs.readFile)(filename, 'utf8').then((css) =>
    parseStylesheet(css, filename)
  );
}

function concatRoots(roots) {
  return roots.reduce((memoRoot, root) => {
    return memoRoot.append(root);
  });
}

function rethrowPostcssError(error) {
  error.message = `PostCSS error: ${error.message}`;
  if (error.name === 'CssSyntaxError') {
    error.message += '\n' + error.showSourceCode();
  }
  throw error;
}

module.exports = { concat, clearCache };

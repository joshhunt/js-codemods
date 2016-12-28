const pathLib = require('path');
const fsLib = require('fs');

const _ = require('lodash');
const isPath = require('is-valid-path');

const TEMPLATE_BASE = '../DIM/app/';

let log;

function _log(file, ...args) {
  console.log(' -', ...args, `(in ${file.path})`);
}

function makePathUrl(relTemplatePath) {
  const finalTemplatePath = relTemplatePath.replace(TEMPLATE_BASE, '');
  return "'" + finalTemplatePath + "'";
}

function transformArray(j, templatePath, prop, value) {
  // log('Transforming template as array');
  const templateString = value.elements.reduce((acc, ele) => {
    let templateStringFrag;

    switch (ele.type) {
      case 'Literal':
        templateStringFrag = ele.rawValue;
        break;

      case 'BinaryExpression':
        // this only works for a simple 'foo' + 'bar'. It doesnt work recursively for
        // things like 'foo' + 'bar' + 'baz', but that doesnt appear in DIM
        if (ele.left.type === 'Literal' && ele.right.type === 'Literal') {
          templateStringFrag = ele.left.rawValue + '\n' + ele.right.rawValue;
          break;
        }

      default:
        throw new Error('Cannot transform template (as array) with element of type ' + ele.type + `(${templatePath})`)
    }

    return acc += '\n' + templateStringFrag;
  }, '');


  j(prop)
    .find('CallExpression') // assuming this is like [...].join()
    .replaceWith(makePathUrl(templatePath))

  return templateString;
}

function transformTemplateLiteral(j, templatePath, prop, value) {
  // log('Transforming template as template string');

  if (value.quasis.length !== 1) {
    log('Cannot transform template (as template string) with interpolated variables');
    return null;
  }

  const templateString = value.quasis[0].value.cooked;

  j(prop)
    .find('TemplateLiteral') // once again, assuming this is like [...].join()
    .replaceWith(makePathUrl(templatePath))

  return templateString;
}

function transformLiteral(j, templatePath, prop, value) {
  // log('Transforming template as literal');

  const templateString = value.raw;

  j(prop)
    .find('Literal') // once again, assuming this is like [...].join()
    .replaceWith(makePathUrl(templatePath));

  return templateString;
}

function findProp(objExp, propName) {
  return objExp.value.properties.find((prop) => {
    return prop.key.name === propName;
  });
}

let counters = {};
function incrementFileCounter(filePath) {
  if (counters[filePath]) {
    counters[filePath] += 1;
  } else {
    counters[filePath] = 1;
  }
}

export default function transformer(file, api, options) {
  const j = api.jscodeshift;

  log = _log.bind(null, file);

  return j(file.source)
    .find(j.ObjectExpression)
    // .filter(path => _.get(path, 'node.argument.type') === 'ObjectExpression')
    .forEach((path, pathIndex) => {

      var templateProp = findProp(path, 'template');
      var plainProp = findProp(path, 'plain');

      if (!templateProp) { return }

      incrementFileCounter(file.path);

      const count = counters[file.path];
      const parsedPath = pathLib.parse(file.path);
      const suffix = count === 1 ? '' : '-' + count;
      const templatePath = pathLib.join(parsedPath.dir, parsedPath.name + suffix + '.html');

      var templateValue = templateProp.value;
      let templateString;

      switch (templateValue.type) {
        case 'CallExpression':
          // Assuming this is [].join()
          var templateArray = templateValue.callee.object;
          if (templateArray.type === 'ArrayExpression') {
            templateString = transformArray(j, templatePath, templateProp, templateArray);
            break;
          } // fall through to default otherwise

        case 'TemplateLiteral':
          templateString = transformTemplateLiteral(j, templatePath, templateProp, templateValue);
          break;

        case 'Literal':
          if (isPath(templateValue.value)) {
            log('Skipping because already a path')
            break;
          }

          templateString = transformLiteral(j, templatePath, templateProp, templateValue);
          break;

        default:
          log(`Don't know how to transform template of type ${templateValue.type} yet`)
      }

      // Quit now if we didnt transform a template
      if (!templateString) { return }

      // update the key
      if (plainProp) {
        // Template is in a ngDialog call, so we need to remove plain: true
        j(path)
          .find(j.Property)
          .filter(prop => prop.value.key.name === 'plain')
          .remove();

      } else {
        // Change from 'template' to 'templateUrl'
        templateProp.key.name = 'templateUrl';
      }

      // Write out the template
      fsLib.writeFileSync(templatePath, templateString);
    })
    .toSource();
}

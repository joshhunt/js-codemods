const pathLib = require('path');
const fsLib = require('fs');

const _ = require('lodash');
const isPath = require('is-valid-path');

const TEMPLATE_BASE = '../DIM/app/';

function log(...args) {
  console.log(' -', ...args);
}

function makePathUrl(relTemplatePath) {
  const finalTemplatePath = relTemplatePath.replace(TEMPLATE_BASE, '');
  return "'" + finalTemplatePath + "'";
}

function transformArray(j, templatePath, prop, value) {
  log('Transforming template as array');
  const templateString = value.elements.reduce((acc, ele) => {
    if (ele.type !== 'Literal') {
      throw new Error('Cannot transform template (as array) with element of type ' + ele.type)
    }

    return acc += '\n' + ele.rawValue
  }, '');


  j(prop)
    .find('CallExpression') // once again, assuming this is like [...].join()
    .replaceWith(makePathUrl(templatePath))

  return templateString;
}

function transformTemplateLiteral(j, templatePath, prop, value) {
  log('Transforming template as template string');

  if (value.quasis.length !== 1) {
    throw new Error('Cannot transform template (as template string) with interpolated variables');
  }

  const templateString = value.quasis[0].value.cooked;

  j(prop)
    .find('TemplateLiteral') // once again, assuming this is like [...].join()
    .replaceWith(makePathUrl(templatePath))

  return templateString;
}

function transformLiteral(j, templatePath, prop, value) {
  log('Transforming template as literal');

  const templateString = value.raw;

  j(prop)
    .find('Literal') // once again, assuming this is like [...].join()
    .replaceWith(makePathUrl(templatePath));

  return templateString;
}

let counters = {};
export default function transformer(file, api) {
  const j = api.jscodeshift;

  return j(file.source)
    .find(j.ObjectExpression)
    // .filter(path => _.get(path, 'node.argument.type') === 'ObjectExpression')
    .forEach((path, pathIndex) => {

      var templateProp = path.value.properties.find((prop) => {
        return prop.key.name === 'template';
      });

      if (!templateProp) {
        return;
      }

      if (counters[file.path]) {
        counters[file.path] += 1;
      } else {
        counters[file.path] = 1;
      }

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
          throw new Error(`Don't know how to transform template of type ${templateValue.type} yet`)
      }

      // Quit now if we didnt transform a template
      if (!templateString) { return }

      // update the key
      templateProp.key.name = 'templateUrl';

      // Write out the template
      fsLib.writeFileSync(templatePath, templateString);
    })
    .toSource();
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LineChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import {
  Activity,
  AlertCircle,
  BookOpen,
  Calculator,
  Gauge,
  History,
  Info,
  LocateFixed,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
  Timer,
  Trash2,
  Wand2,
  Waves,
} from 'lucide-react';
import './styles.css';

echarts.use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent]);

const SETTLING_BAND = 0.02;
const HISTORY_LIMIT = 8;
const DEFAULT_TRANSFER_FUNCTION = '10 / (s^2 + 3s + 10)';
const PROJECT_FEATURES = ['根轨迹', '波特图', 'Nyquist 图', '单位阶跃响应', '参数实时计算', '历史记录'];
const CHANGELOG_ITEMS = [
  { version: 'v0.1', text: '完成基础参数计算' },
  { version: 'v0.2', text: '增加根轨迹图' },
  { version: 'v0.3', text: '增加阶跃响应' },
  { version: 'v0.4', text: '增加波特图' },
  { version: 'v0.5', text: '支持手机端和 PWA/APP 化探索' },
  { version: 'v0.6', text: '增加真实计算的 Nyquist 图模块' },
];

function parseNumber(value) {
  if (value.trim() === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function getOvershootError(mp) {
  if (mp === null) {
    return '请输入超调量 Mp';
  }

  if (Number.isNaN(mp)) {
    return '请输入有效的超调量数值';
  }

  if (mp <= 0 || mp >= 100) {
    return '超调量 Mp 需要大于 0 且小于 100';
  }

  return '';
}

function getSettlingTimeError(ts) {
  if (ts === null) {
    return '请输入调整时间 Ts';
  }

  if (Number.isNaN(ts)) {
    return '请输入有效的调整时间数值';
  }

  if (ts <= 0) {
    return '调整时间 Ts 必须大于 0';
  }

  return '';
}

function calculateParameters(mp, ts) {
  const logMp = Math.log(mp / 100);
  const dampingRatio = -logMp / Math.sqrt(Math.PI ** 2 + logMp ** 2);
  const naturalFrequency = 4 / (dampingRatio * ts);

  return {
    dampingRatio,
    naturalFrequency,
  };
}

function getStepValue(t, dampingRatio, naturalFrequency) {
  if (!Number.isFinite(t) || t < 0) {
    return 0;
  }

  if (dampingRatio < 1) {
    const dampedFrequency = naturalFrequency * Math.sqrt(1 - dampingRatio ** 2);
    const phase = Math.atan(Math.sqrt(1 - dampingRatio ** 2) / dampingRatio);
    const envelope = Math.exp(-dampingRatio * naturalFrequency * t);
    return 1 - (envelope / Math.sqrt(1 - dampingRatio ** 2)) * Math.sin(dampedFrequency * t + phase);
  }

  if (dampingRatio === 1) {
    return 1 - Math.exp(-naturalFrequency * t) * (1 + naturalFrequency * t);
  }

  const root = Math.sqrt(dampingRatio ** 2 - 1);
  const pole1 = -naturalFrequency * (dampingRatio - root);
  const pole2 = -naturalFrequency * (dampingRatio + root);
  return 1 + (pole2 * Math.exp(pole1 * t) - pole1 * Math.exp(pole2 * t)) / (pole1 - pole2);
}

function calculateStepResponse(dampingRatio, naturalFrequency) {
  if (dampingRatio <= 0 || naturalFrequency <= 0) {
    return null;
  }

  const expectedSettlingTime = 4 / (dampingRatio * naturalFrequency);
  const peakTime =
    dampingRatio < 1
      ? Math.PI / (naturalFrequency * Math.sqrt(1 - dampingRatio ** 2))
      : expectedSettlingTime;
  const duration = Math.max(expectedSettlingTime * 1.8, peakTime * 1.45, 6 / naturalFrequency);
  const sampleCount = 180;
  const points = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const t = (duration * index) / sampleCount;
    return {
      t,
      y: getStepValue(t, dampingRatio, naturalFrequency),
    };
  });

  const peak = points.reduce((best, point) => (point.y > best.y ? point : best), points[0]);
  const overshoot = Math.max(0, (peak.y - 1) * 100);
  const lastOutsideIndex = points.findLastIndex((point) => Math.abs(point.y - 1) > SETTLING_BAND);
  const settlingTime =
    lastOutsideIndex === -1 || lastOutsideIndex === points.length - 1
      ? expectedSettlingTime
      : points[lastOutsideIndex + 1].t;

  return {
    duration,
    overshoot,
    peak,
    points,
    settlingTime,
  };
}

function normalizePolynomialInput(text) {
  return text
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[−–—]/g, '-')
    .replace(/\^/g, '^');
}

function trimOuterParentheses(value) {
  let text = value;
  let changed = true;

  while (changed && text.startsWith('(') && text.endsWith(')')) {
    changed = false;
    let depth = 0;
    let wraps = true;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
      }

      if (depth === 0 && index < text.length - 1) {
        wraps = false;
        break;
      }
    }

    if (wraps) {
      text = text.slice(1, -1);
      changed = true;
    }
  }

  return text;
}

function splitTransferFunction(text) {
  const normalized = normalizePolynomialInput(text);
  let depth = 0;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '(' || char === '[') {
      depth += 1;
    } else if (char === ')' || char === ']') {
      depth -= 1;
    } else if (char === '/' && depth === 0) {
      return [normalized.slice(0, index), normalized.slice(index + 1)];
    }
  }

  return null;
}

function parseCoefficientList(text) {
  const listMatch = text.match(/^\[([^\]]+)\]$/);
  if (!listMatch) {
    return null;
  }

  const values = listMatch[1].split(',').map((item) => Number(item.trim()));
  return values.every((value) => Number.isFinite(value)) ? trimLeadingZeros(values) : null;
}

function trimLeadingZeros(coefficients) {
  const firstNonZero = coefficients.findIndex((value) => Math.abs(value) > 1e-12);
  if (firstNonZero === -1) {
    return [0];
  }

  return coefficients.slice(firstNonZero);
}

function multiplyPolynomials(left, right) {
  const result = Array(left.length + right.length - 1).fill(0);
  left.forEach((leftCoefficient, leftIndex) => {
    right.forEach((rightCoefficient, rightIndex) => {
      result[leftIndex + rightIndex] += leftCoefficient * rightCoefficient;
    });
  });

  return trimLeadingZeros(result);
}

function addPolynomials(left, right) {
  const length = Math.max(left.length, right.length);
  const paddedLeft = padPolynomial(left, length);
  const paddedRight = padPolynomial(right, length);
  return trimLeadingZeros(paddedLeft.map((coefficient, index) => coefficient + paddedRight[index]));
}

function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let startIndex = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(' || char === '[') {
      depth += 1;
    } else if (char === ')' || char === ']') {
      depth -= 1;
    } else if (char === separator && depth === 0) {
      parts.push(text.slice(startIndex, index));
      startIndex = index + 1;
    }
  }

  parts.push(text.slice(startIndex));
  return parts;
}

function insertImplicitMultiplication(text) {
  let result = '';

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    result += char;

    if (!next) {
      continue;
    }

    const currentEndsFactor = /[\d.s)\]]/.test(char);
    const nextStartsGroupedFactor = /[(\[]/.test(next);
    const currentEndsGroupedFactor = /[)\]]/.test(char);
    const nextStartsBareFactor = next === 's';
    if ((currentEndsFactor && nextStartsGroupedFactor) || (currentEndsGroupedFactor && nextStartsBareFactor)) {
      result += '*';
    }
  }

  return result;
}

function splitAdditiveTerms(text) {
  const terms = [];
  let depth = 0;
  let startIndex = 0;
  let sign = 1;

  if (text[0] === '+' || text[0] === '-') {
    sign = text[0] === '-' ? -1 : 1;
    startIndex = 1;
  }

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(' || char === '[') {
      depth += 1;
    } else if (char === ')' || char === ']') {
      depth -= 1;
    } else if ((char === '+' || char === '-') && depth === 0 && text[index - 1] !== '^') {
      const term = text.slice(startIndex, index);
      if (!term) {
        return null;
      }
      terms.push({ sign, term });
      sign = char === '-' ? -1 : 1;
      startIndex = index + 1;
    }
  }

  const term = text.slice(startIndex);
  if (!term) {
    return null;
  }
  terms.push({ sign, term });
  return terms;
}

function parseMonomial(text) {
  const term = trimOuterParentheses(text);
  const sIndex = term.indexOf('s');
  let coefficient = 0;
  let power = 0;

  if (sIndex === -1) {
    coefficient = Number(term);
  } else {
    if (term.indexOf('s', sIndex + 1) !== -1) {
      return null;
    }

    const coefficientText = term.slice(0, sIndex);
    if (coefficientText === '' || coefficientText === '+') {
      coefficient = 1;
    } else if (coefficientText === '-') {
      coefficient = -1;
    } else {
      coefficient = Number(coefficientText);
    }

    const powerMatch = term.slice(sIndex).match(/^s(?:\^(-?\d+))?$/);
    if (!powerMatch) {
      return null;
    }
    power = powerMatch[1] ? Number(powerMatch[1]) : 1;
  }

  if (!Number.isFinite(coefficient) || !Number.isInteger(power) || power < 0) {
    return null;
  }

  return trimLeadingZeros(
    Array.from({ length: power + 1 }, (_, index) => (index === 0 ? coefficient : 0)),
  );
}

function parsePolynomialProduct(text) {
  const multipliedText = insertImplicitMultiplication(text);
  const factors = splitTopLevel(multipliedText, '*');
  if (factors.length > 1) {
    return factors.reduce((product, factor) => {
      if (!product || !factor) {
        return null;
      }

      const parsedFactor = parsePolynomial(factor);
      return parsedFactor ? multiplyPolynomials(product, parsedFactor) : null;
    }, [1]);
  }

  return parseMonomial(multipliedText);
}

function parsePolynomial(text) {
  const list = parseCoefficientList(text);
  if (list) {
    return list;
  }

  const cleanText = trimOuterParentheses(text);
  if (!cleanText) {
    return null;
  }

  const terms = splitAdditiveTerms(cleanText);
  if (!terms) {
    return null;
  }

  return terms.reduce((total, { sign, term }) => {
    if (!total) {
      return null;
    }

    const parsedTerm = parsePolynomialProduct(term);
    if (!parsedTerm) {
        return null;
    }

    const signedTerm = parsedTerm.map((coefficient) => coefficient * sign);
    return addPolynomials(total, signedTerm);
  }, [0]);
}

function parseTransferFunction(input) {
  const parts = splitTransferFunction(input);
  if (!parts) {
    return { error: '请使用 num / den 格式，例如 10 / (s^2 + 3s + 10)' };
  }

  const numerator = parsePolynomial(parts[0]);
  const denominator = parsePolynomial(parts[1]);

  if (!numerator || !denominator) {
    return { error: '暂不支持该传递函数格式，请输入 s 多项式或系数数组' };
  }

  if (denominator.every((value) => Math.abs(value) < 1e-12)) {
    return { error: '分母不能为 0' };
  }

  return { numerator, denominator, error: '' };
}

function complex(real, imaginary = 0) {
  return { real, imaginary };
}

function complexAdd(a, b) {
  return complex(a.real + b.real, a.imaginary + b.imaginary);
}

function complexSubtract(a, b) {
  return complex(a.real - b.real, a.imaginary - b.imaginary);
}

function complexMultiply(a, b) {
  return complex(a.real * b.real - a.imaginary * b.imaginary, a.real * b.imaginary + a.imaginary * b.real);
}

function complexDivide(a, b) {
  const denominator = b.real ** 2 + b.imaginary ** 2;
  return complex(
    (a.real * b.real + a.imaginary * b.imaginary) / denominator,
    (a.imaginary * b.real - a.real * b.imaginary) / denominator,
  );
}

function complexAbs(value) {
  return Math.hypot(value.real, value.imaginary);
}

function evaluatePolynomialComplex(coefficients, value) {
  return coefficients.reduce(
    (result, coefficient) => complexAdd(complexMultiply(result, value), complex(coefficient, 0)),
    complex(0, 0),
  );
}

function cleanComplex(value) {
  const real = Math.abs(value.real) < 1e-9 ? 0 : value.real;
  const imaginary = Math.abs(value.imaginary) < 1e-9 ? 0 : value.imaginary;
  return { real, imaginary };
}

function solvePolynomialRoots(coefficients) {
  const cleanCoefficients = trimLeadingZeros(coefficients);
  const degree = cleanCoefficients.length - 1;

  if (degree <= 0) {
    return [];
  }

  if (degree === 1) {
    return [complex(-cleanCoefficients[1] / cleanCoefficients[0], 0)];
  }

  if (degree === 2) {
    const [a, b, c] = cleanCoefficients;
    const discriminant = b ** 2 - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      return [complex((-b + root) / (2 * a), 0), complex((-b - root) / (2 * a), 0)];
    }

    const imaginary = Math.sqrt(-discriminant) / (2 * a);
    return [complex(-b / (2 * a), imaginary), complex(-b / (2 * a), -imaginary)];
  }

  const leading = cleanCoefficients[0];
  const normalized = cleanCoefficients.map((coefficient) => coefficient / leading);
  const radius = 1 + Math.max(...normalized.slice(1).map((coefficient) => Math.abs(coefficient)));
  let roots = Array.from({ length: degree }, (_, index) => {
    const angle = (2 * Math.PI * index) / degree + 0.37;
    return complex(radius * Math.cos(angle), radius * Math.sin(angle));
  });

  for (let iteration = 0; iteration < 100; iteration += 1) {
    let maxDelta = 0;
    roots = roots.map((root, rootIndex) => {
      const denominator = roots.reduce((product, otherRoot, otherIndex) => {
        if (rootIndex === otherIndex) {
          return product;
        }

        const difference = complexSubtract(root, otherRoot);
        return complexMultiply(product, complexAbs(difference) < 1e-12 ? complex(1e-12, 1e-12) : difference);
      }, complex(1, 0));
      const delta = complexDivide(evaluatePolynomialComplex(normalized, root), denominator);
      maxDelta = Math.max(maxDelta, complexAbs(delta));
      return complexSubtract(root, delta);
    });

    if (maxDelta < 1e-10) {
      break;
    }
  }

  return roots.map(cleanComplex);
}

function padPolynomial(coefficients, length) {
  return [...Array(Math.max(0, length - coefficients.length)).fill(0), ...coefficients];
}

function addScaledPolynomials(denominator, numerator, gain) {
  const length = Math.max(denominator.length, numerator.length);
  const paddedDenominator = padPolynomial(denominator, length);
  const paddedNumerator = padPolynomial(numerator, length);
  return trimLeadingZeros(paddedDenominator.map((coefficient, index) => coefficient + gain * paddedNumerator[index]));
}

function getPolynomialScale(coefficients) {
  return Math.max(...coefficients.map((coefficient) => Math.abs(coefficient)), 1e-9);
}

function chooseRootLocusGainRange(numerator, denominator) {
  const ratio = getPolynomialScale(denominator) / getPolynomialScale(numerator);
  return Math.min(Math.max(ratio * 100, 10), 1e6);
}

function sortRootsForStableStart(roots) {
  return [...roots].sort((left, right) => left.real - right.real || left.imaginary - right.imaginary);
}

function assignRootsToBranches(previousRoots, nextRoots) {
  const remaining = [...nextRoots];
  return previousRoots.map((previousRoot) => {
    let bestIndex = 0;
    let bestDistance = Infinity;
    remaining.forEach((root, index) => {
      const distance = Math.hypot(root.real - previousRoot.real, root.imaginary - previousRoot.imaginary);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return remaining.splice(bestIndex, 1)[0];
  });
}

function calculateRootLocus(input) {
  const parsed = parseTransferFunction(input);
  if (parsed.error) {
    return { error: parsed.error };
  }

  if (parsed.numerator.every((value) => Math.abs(value) < 1e-12)) {
    return { error: '鍒嗗瓙涓嶈兘涓?0' };
  }

  if (parsed.numerator.length > parsed.denominator.length) {
    return { error: '鏍硅建杩归渶瑕佺湡鏈夌悊鎴栨鍒欑殑寮€鐜紶閫掑嚱鏁?' };
  }

  const openLoopPoles = solvePolynomialRoots(parsed.denominator);
  const openLoopZeros = solvePolynomialRoots(parsed.numerator);
  const sampleCount = 180;
  const maxGain = chooseRootLocusGainRange(parsed.numerator, parsed.denominator);
  const gains = [
    0,
    ...Array.from({ length: sampleCount }, (_, index) => {
      const ratio = index / (sampleCount - 1);
      return maxGain * ratio ** 2;
    }).filter((gain) => gain > 0),
  ];
  const branches = openLoopPoles.map(() => []);
  let previousRoots = null;

  gains.forEach((gain) => {
    const characteristic = addScaledPolynomials(parsed.denominator, parsed.numerator, gain);
    const rawRoots = solvePolynomialRoots(characteristic);
    const roots = previousRoots ? assignRootsToBranches(previousRoots, rawRoots) : sortRootsForStableStart(rawRoots);

    roots.forEach((root, index) => {
      if (branches[index]) {
        branches[index].push({ gain, ...root });
      }
    });
    previousRoots = roots;
  });

  const currentPoles = solvePolynomialRoots(addScaledPolynomials(parsed.denominator, parsed.numerator, 1));

  return {
    branches,
    currentGain: 1,
    currentPoles,
    error: '',
    maxGain,
    openLoopPoles,
    openLoopZeros,
  };
}

function evaluatePolynomial(coefficients, omega) {
  let real = 0;
  let imaginary = 0;
  const order = coefficients.length - 1;

  coefficients.forEach((coefficient, index) => {
    const power = order - index;
    const magnitude = coefficient * omega ** power;
    const phase = (power * Math.PI) / 2;
    real += magnitude * Math.cos(phase);
    imaginary += magnitude * Math.sin(phase);
  });

  return { real, imaginary };
}

function divideComplex(a, b) {
  const denominator = b.real ** 2 + b.imaginary ** 2;
  return {
    real: (a.real * b.real + a.imaginary * b.imaginary) / denominator,
    imaginary: (a.imaginary * b.real - a.real * b.imaginary) / denominator,
  };
}

function unwrapDegrees(phases) {
  const unwrapped = [];
  let offset = 0;

  phases.forEach((phase, index) => {
    if (index > 0) {
      const delta = phase + offset - unwrapped[index - 1];
      if (delta > 180) {
        offset -= 360;
      } else if (delta < -180) {
        offset += 360;
      }
    }
    unwrapped.push(phase + offset);
  });

  return unwrapped;
}

function interpolateLogFrequency(left, right, targetKey, targetValue) {
  const leftValue = left[targetKey];
  const rightValue = right[targetKey];
  const ratio = (targetValue - leftValue) / (rightValue - leftValue);
  const logW = Math.log10(left.w) + ratio * (Math.log10(right.w) - Math.log10(left.w));
  return 10 ** logW;
}

function interpolateValue(left, right, frequency, key) {
  const ratio = (Math.log10(frequency) - Math.log10(left.w)) / (Math.log10(right.w) - Math.log10(left.w));
  return left[key] + ratio * (right[key] - left[key]);
}

function calculateBode(input) {
  const parsed = parseTransferFunction(input);
  if (parsed.error) {
    return { error: parsed.error };
  }

  const frequencyCount = 420;
  const minExponent = -2;
  const maxExponent = 3;
  const rawPoints = Array.from({ length: frequencyCount }, (_, index) => {
    const exponent = minExponent + ((maxExponent - minExponent) * index) / (frequencyCount - 1);
    const w = 10 ** exponent;
    const numerator = evaluatePolynomial(parsed.numerator, w);
    const denominator = evaluatePolynomial(parsed.denominator, w);
    const response = divideComplex(numerator, denominator);
    const magnitude = Math.sqrt(response.real ** 2 + response.imaginary ** 2);
    const magnitudeDb = 20 * Math.log10(Math.max(magnitude, 1e-16));
    const phase = (Math.atan2(response.imaginary, response.real) * 180) / Math.PI;
    return { w, magnitude, magnitudeDb, phase };
  });

  const phases = unwrapDegrees(rawPoints.map((point) => point.phase));
  const points = rawPoints.map((point, index) => ({ ...point, phase: phases[index] }));
  let cutoffFrequency = null;
  let phaseMargin = null;
  let gainMargin = null;
  let phaseCrossFrequency = null;

  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    const crossesUnity =
      (left.magnitudeDb >= 0 && right.magnitudeDb <= 0) || (left.magnitudeDb <= 0 && right.magnitudeDb >= 0);

    if (crossesUnity && left.magnitudeDb !== right.magnitudeDb) {
      cutoffFrequency = interpolateLogFrequency(left, right, 'magnitudeDb', 0);
      const phaseAtCutoff = interpolateValue(left, right, cutoffFrequency, 'phase');
      phaseMargin = 180 + phaseAtCutoff;
      break;
    }
  }

  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    const crossesMinus180 = (left.phase >= -180 && right.phase <= -180) || (left.phase <= -180 && right.phase >= -180);

    if (crossesMinus180 && left.phase !== right.phase) {
      phaseCrossFrequency = interpolateLogFrequency(left, right, 'phase', -180);
      const magnitudeAtPhaseCross = interpolateValue(left, right, phaseCrossFrequency, 'magnitudeDb');
      gainMargin = -magnitudeAtPhaseCross;
      break;
    }
  }

  return {
    cutoffFrequency,
    denominator: parsed.denominator,
    error: '',
    gainMargin,
    numerator: parsed.numerator,
    phaseCrossFrequency,
    phaseMargin,
    points,
  };
}

function evaluateTransferAtOmega(parsed, omega) {
  const numerator = evaluatePolynomial(parsed.numerator, omega);
  const denominator = evaluatePolynomial(parsed.denominator, omega);
  const denominatorMagnitude = Math.hypot(denominator.real, denominator.imaginary);

  if (denominatorMagnitude < 1e-14) {
    return null;
  }

  const response = divideComplex(numerator, denominator);
  const magnitude = Math.hypot(response.real, response.imaginary);
  const phase = (Math.atan2(response.imaginary, response.real) * 180) / Math.PI;

  if (![response.real, response.imaginary, magnitude, phase].every(Number.isFinite)) {
    return null;
  }

  return {
    distanceToCritical: Math.hypot(response.real + 1, response.imaginary),
    imaginary: response.imaginary,
    magnitude,
    phase,
    real: response.real,
    w: omega,
  };
}

function calculateNyquist(input) {
  const parsed = parseTransferFunction(input);
  if (parsed.error) {
    return { error: parsed.error };
  }

  const frequencyCount = 520;
  const minExponent = -2;
  const maxExponent = 3;
  const frequencies = Array.from({ length: frequencyCount }, (_, index) => {
    const exponent = minExponent + ((maxExponent - minExponent) * index) / (frequencyCount - 1);
    return 10 ** exponent;
  });

  const positivePoints = frequencies.map((frequency) => evaluateTransferAtOmega(parsed, frequency)).filter(Boolean);
  const negativePoints = frequencies.map((frequency) => evaluateTransferAtOmega(parsed, -frequency)).filter(Boolean);
  const allPoints = [...positivePoints, ...negativePoints];
  const closestPoint = allPoints.reduce(
    (closest, point) => (!closest || point.distanceToCritical < closest.distanceToCritical ? point : closest),
    null,
  );
  const openLoopPoles = solvePolynomialRoots(parsed.denominator);
  const openLoopRightHalfPoles = openLoopPoles.filter((pole) => pole.real > 1e-7).length;
  const closedLoopPoles = solvePolynomialRoots(addScaledPolynomials(parsed.denominator, parsed.numerator, 1));
  const closedLoopRightHalfPoles = closedLoopPoles.filter((pole) => pole.real > 1e-7).length;

  return {
    closestPoint,
    closedLoopPoles,
    closedLoopRightHalfPoles,
    error: '',
    maxFrequency: frequencies[frequencies.length - 1],
    minFrequency: frequencies[0],
    negativePoints,
    openLoopPoles,
    openLoopRightHalfPoles,
    positivePoints,
  };
}

function formatNumber(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return value.toLocaleString('zh-CN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatCompact(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return value.toLocaleString('zh-CN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function buildSmoothPath(points, xScale, yScale) {
  if (points.length === 0) {
    return '';
  }

  return points.reduce((path, point, index) => {
    const x = xScale(point.t);
    const y = yScale(point.y);

    if (index === 0) {
      return `M ${x} ${y}`;
    }

    const previous = points[index - 1];
    const previousX = xScale(previous.t);
    const previousY = yScale(previous.y);
    const controlX = (previousX + x) / 2;
    return `${path} C ${controlX} ${previousY}, ${controlX} ${y}, ${x} ${y}`;
  }, '');
}

function buildRootLocusPath(points, xScale, yScale) {
  return points.reduce((path, point, index) => {
    const x = xScale(point.real);
    const y = yScale(point.imaginary);
    return index === 0 ? `M ${x} ${y}` : `${path} L ${x} ${y}`;
  }, '');
}

function buildNyquistArrowMarks(points, count = 5) {
  if (points.length < 3) {
    return [];
  }

  const step = Math.max(2, Math.floor(points.length / (count + 1)));
  return Array.from({ length: count }, (_, index) => {
    const endIndex = Math.min(points.length - 1, (index + 1) * step);
    const startIndex = Math.max(0, endIndex - Math.max(1, Math.floor(step * 0.24)));
    const start = points[startIndex];
    const end = points[endIndex];
    return [{ coord: [start.real, start.imaginary] }, { coord: [end.real, end.imaginary] }];
  });
}

function getChartTextColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#64748b';
}

function getChartGridColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || 'rgba(148, 163, 184, 0.28)';
}

function EChart({ option, className = 'bode-chart' }) {
  const chartRef = useRef(null);
  const instanceRef = useRef(null);

  useEffect(() => {
    if (!chartRef.current) {
      return undefined;
    }

    instanceRef.current = echarts.init(chartRef.current, null, { renderer: 'canvas' });
    const observer = new ResizeObserver(() => instanceRef.current?.resize());
    observer.observe(chartRef.current);

    return () => {
      observer.disconnect();
      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (instanceRef.current) {
      instanceRef.current.setOption(option, true);
    }
  }, [option]);

  return <div className={className} ref={chartRef} />;
}

function InputField({ label, value, onChange, unit, error, placeholder, icon: Icon }) {
  return (
    <label className="field">
      <span className="field-label">
        <Icon size={18} aria-hidden="true" />
        {label}
      </span>
      <div className={`input-wrap ${error ? 'has-error' : ''}`}>
        <input
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
        />
        <span className="unit">{unit}</span>
      </div>
      {error ? (
        <span className="error-message">
          <AlertCircle size={15} aria-hidden="true" />
          {error}
        </span>
      ) : null}
    </label>
  );
}

function ResultCard({ title, value, unit, description }) {
  return (
    <section className="result-card">
      <span className="result-title">{title}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
      <p>{description}</p>
    </section>
  );
}

function StepResponseChart({ response }) {
  if (!response) {
    return (
      <section className="chart-panel empty-chart" aria-label="单位阶跃响应曲线">
        <Activity size={28} aria-hidden="true" />
        <p>输入有效参数后，将自动生成单位阶跃响应曲线。</p>
      </section>
    );
  }

  const width = 760;
  const height = 360;
  const padding = { top: 32, right: 40, bottom: 46, left: 58 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const yMax = Math.max(1.22, response.peak.y + 0.12);
  const yMin = -0.04;
  const xScale = (t) => padding.left + (t / response.duration) * plotWidth;
  const yScale = (y) => padding.top + ((yMax - y) / (yMax - yMin)) * plotHeight;
  const path = buildSmoothPath(response.points, xScale, yScale);
  const peakX = xScale(response.peak.t);
  const peakY = yScale(response.peak.y);
  const settlingX = xScale(response.settlingTime);
  const upperBandY = yScale(1 + SETTLING_BAND);
  const lowerBandY = yScale(1 - SETTLING_BAND);
  const steadyY = yScale(1);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ratio * response.duration);

  return (
    <section className="chart-panel" aria-label="单位阶跃响应曲线">
      <div className="chart-header">
        <div>
          <span>Step Response</span>
          <h2>单位阶跃响应</h2>
        </div>
        <div className="chart-metrics">
          <strong>{formatCompact(response.overshoot, 2)}%</strong>
          <span>超调量</span>
          <strong>{formatCompact(response.settlingTime, 2)}s</strong>
          <span>调整时间</span>
        </div>
      </div>

      <svg className="response-chart" viewBox={`0 0 ${width} ${height}`} role="img">
        <defs>
          <linearGradient id="responseGradient" x1="0%" x2="100%" y1="0%" y2="0%">
            <stop offset="0%" stopColor="#1677ff" />
            <stop offset="55%" stopColor="#7c3aed" />
            <stop offset="100%" stopColor="#16c8b7" />
          </linearGradient>
          <linearGradient id="responseFill" x1="0%" x2="0%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="#1677ff" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#16c8b7" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        <rect
          className="chart-band"
          x={padding.left}
          y={upperBandY}
          width={plotWidth}
          height={lowerBandY - upperBandY}
        />

        {[0, 0.5, 1, yMax].map((value) => (
          <g key={value}>
            <line className="grid-line" x1={padding.left} x2={width - padding.right} y1={yScale(value)} y2={yScale(value)} />
            <text className="axis-label" x={padding.left - 12} y={yScale(value) + 4} textAnchor="end">
              {formatCompact(value, 2)}
            </text>
          </g>
        ))}

        {ticks.map((tick) => (
          <g key={tick}>
            <line className="grid-line vertical" x1={xScale(tick)} x2={xScale(tick)} y1={padding.top} y2={height - padding.bottom} />
            <text className="axis-label" x={xScale(tick)} y={height - 18} textAnchor="middle">
              {formatCompact(tick, 1)}s
            </text>
          </g>
        ))}

        <path className="response-area" d={`${path} L ${width - padding.right} ${yScale(0)} L ${padding.left} ${yScale(0)} Z`} />
        <line className="steady-line" x1={padding.left} x2={width - padding.right} y1={steadyY} y2={steadyY} />
        <line className="settling-line" x1={settlingX} x2={settlingX} y1={padding.top} y2={height - padding.bottom} />
        <path className="response-line" d={path} />

        <circle className="peak-dot" cx={peakX} cy={peakY} r="6" />
        <text className="callout-label" x={Math.min(peakX + 14, width - 170)} y={Math.max(peakY - 14, 24)}>
          超调量 {formatCompact(response.overshoot, 2)}%
        </text>
        <text className="callout-label" x={Math.min(settlingX + 12, width - 176)} y={padding.top + 24}>
          Ts = {formatCompact(response.settlingTime, 2)}s
        </text>
      </svg>
    </section>
  );
}

function RootLocusChart({ locus }) {
  const [zoom, setZoom] = useState(1);

  if (!locus) {
    return (
      <section className="chart-panel empty-chart" aria-label="根轨迹图">
        <Activity size={28} aria-hidden="true" />
        <p>输入有效参数后，将自动生成根轨迹图。</p>
      </section>
    );
  }

  if (locus.error) {
    return (
      <section className="chart-panel empty-chart" aria-label="Root Locus">
        <AlertCircle size={28} aria-hidden="true" />
        <p>{locus.error}</p>
      </section>
    );
  }

  const width = 760;
  const height = 360;
  const padding = { top: 34, right: 38, bottom: 48, left: 62 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const allPoints = [
    ...locus.branches.flat(),
    ...locus.openLoopPoles,
    ...locus.openLoopZeros,
    ...locus.currentPoles,
    { real: 0, imaginary: 0 },
  ];
  const allReals = allPoints.map((point) => point.real);
  const allImaginaries = allPoints.map((point) => point.imaginary);
  const realMinRaw = Math.min(...allReals);
  const realMaxRaw = Math.max(...allReals);
  const realPadding = Math.max((realMaxRaw - realMinRaw) * 0.12, 0.6);
  const realMinBase = realMinRaw - realPadding;
  const realMaxBase = realMaxRaw + realPadding;
  const imaginaryMaxBase = Math.max(0.5, Math.max(...allImaginaries.map(Math.abs)) * 1.16);
  const realCenter = (realMinBase + realMaxBase) / 2;
  const realHalfRange = ((realMaxBase - realMinBase) / 2) / zoom;
  const imaginaryHalfRange = imaginaryMaxBase / zoom;
  const realMin = realCenter - realHalfRange;
  const realMax = realCenter + realHalfRange;
  const imaginaryMin = -imaginaryHalfRange;
  const imaginaryMax = imaginaryHalfRange;
  const xScale = (real) => padding.left + ((real - realMin) / (realMax - realMin)) * plotWidth;
  const yScale = (imaginary) =>
    padding.top + ((imaginaryMax - imaginary) / (imaginaryMax - imaginaryMin)) * plotHeight;
  const imaginaryTitleX = Math.min(Math.max(xScale(0) + 10, padding.left + 10), width - padding.right - 42);
  const branchPaths = locus.branches.map((branch) => buildRootLocusPath(branch, xScale, yScale));
  const currentPoleKey = locus.currentPoles.map((pole) => `${pole.real.toFixed(4)}:${pole.imaginary.toFixed(4)}`).join('|');
  const realTicks = [realMin, (realMin + 0) / 2, 0, realMax / 2].filter(
    (value, index, values) => value >= realMin && value <= realMax && values.indexOf(value) === index,
  );
  const imaginaryTicks = [-imaginaryHalfRange, -imaginaryHalfRange / 2, 0, imaginaryHalfRange / 2, imaginaryHalfRange];

  function updateZoom(nextZoom) {
    setZoom(Math.min(2.4, Math.max(0.7, Number(nextZoom.toFixed(2)))));
  }

  return (
    <section className="chart-panel root-locus-panel" aria-label="根轨迹图">
      <div className="chart-header">
        <div>
          <span>Root Locus</span>
          <h2>根轨迹图</h2>
        </div>
        <div className="chart-tools" aria-label="根轨迹缩放控制">
          <button type="button" className="icon-button" onClick={() => updateZoom(zoom * 1.18)} title="放大" aria-label="放大根轨迹">
            <Plus size={17} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" onClick={() => updateZoom(zoom / 1.18)} title="缩小" aria-label="缩小根轨迹">
            <Minus size={17} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" onClick={() => setZoom(1)} title="重置视图" aria-label="重置根轨迹视图">
            <LocateFixed size={17} aria-hidden="true" />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
        </div>
      </div>

      <svg className="response-chart root-locus-chart" viewBox={`0 0 ${width} ${height}`} role="img">
        <defs>
          <linearGradient id="rootLocusGradient" x1="0%" x2="100%" y1="0%" y2="0%">
            <stop offset="0%" stopColor="#1677ff" />
            <stop offset="52%" stopColor="#7c3aed" />
            <stop offset="100%" stopColor="#16c8b7" />
          </linearGradient>
          <filter id="poleGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {imaginaryTicks.map((tick) => (
          <g key={`imaginary-${tick}`}>
            <line className="grid-line" x1={padding.left} x2={width - padding.right} y1={yScale(tick)} y2={yScale(tick)} />
            <text className="axis-label" x={padding.left - 12} y={yScale(tick) + 4} textAnchor="end">
              {formatCompact(tick, 1)}
            </text>
          </g>
        ))}

        {realTicks.map((tick) => (
          <g key={`real-${tick}`}>
            <line className="grid-line vertical" x1={xScale(tick)} x2={xScale(tick)} y1={padding.top} y2={height - padding.bottom} />
            <text className="axis-label" x={xScale(tick)} y={height - 18} textAnchor="middle">
              {formatCompact(tick, 1)}
            </text>
          </g>
        ))}

        <line className="root-axis" x1={padding.left} x2={width - padding.right} y1={yScale(0)} y2={yScale(0)} />
        <line className="root-axis" x1={xScale(0)} x2={xScale(0)} y1={padding.top} y2={height - padding.bottom} />
        {branchPaths.map((path, index) => (
          <path className={`root-locus-line ${index % 2 === 1 ? 'mirror' : ''}`} d={path} key={`branch-${index}`} />
        ))}

        {locus.openLoopZeros.map((zero, index) => (
          <g className="root-marker zero-marker" key={`zero-${index}`} transform={`translate(${xScale(zero.real)} ${yScale(zero.imaginary)})`}>
            <circle r="7" />
          </g>
        ))}
        {locus.openLoopPoles.map((pole, index) => (
          <g className="root-marker pole-marker" key={`pole-${index}`} transform={`translate(${xScale(pole.real)} ${yScale(pole.imaginary)})`}>
            <line x1="-7" x2="7" y1="-7" y2="7" />
            <line x1="-7" x2="7" y1="7" y2="-7" />
          </g>
        ))}

        <g className="current-poles" key={currentPoleKey}>
          {locus.currentPoles.map((pole, index) => (
            <g className="current-pole" key={`${pole.real}-${pole.imaginary}-${index}`} transform={`translate(${xScale(pole.real)} ${yScale(pole.imaginary)})`}>
              <circle r="8" />
              <circle r="3" />
            </g>
          ))}
        </g>

        <text className="axis-title" x={width - padding.right} y={yScale(0) - 10} textAnchor="end">
          Real
        </text>
        <text className="axis-title" x={imaginaryTitleX} y={padding.top + 14}>
          Imag
        </text>
      </svg>

      <div className="root-locus-legend">
        <span>
          <i className="legend-line" />
          K: 0 {'->'} {formatCompact(locus.maxGain, 2)}
        </span>
        <span>
          <i className="legend-dot" /> K = {formatCompact(locus.currentGain, 2)}
          当前闭环极点
        </span>
      </div>
    </section>
  );
}

function BodePanel({ input, onChange, bode, onExample }) {
  const option = useMemo(() => {
    if (!bode || bode.error) {
      return null;
    }

    const textColor = getChartTextColor();
    const gridColor = getChartGridColor();
    const frequencies = bode.points.map((point) => point.w);
    const magnitude = bode.points.map((point) => [point.w, point.magnitudeDb]);
    const phase = bode.points.map((point) => [point.w, point.phase]);

    return {
      animationDuration: 550,
      backgroundColor: 'transparent',
      color: ['#1677ff', '#16c8b7'],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1], filterMode: 'none', zoomOnMouseWheel: true, moveOnMouseMove: true },
        { type: 'slider', xAxisIndex: [0, 1], bottom: 8, height: 22, borderColor: gridColor, fillerColor: 'rgba(22,119,255,0.18)', dataBackground: { lineStyle: { color: '#1677ff' }, areaStyle: { color: 'rgba(22,119,255,0.08)' } } },
      ],
      grid: [
        { top: 28, left: 64, right: 28, height: '35%' },
        { top: '56%', left: 64, right: 28, height: '28%' },
      ],
      legend: { top: 0, right: 16, textStyle: { color: textColor } },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', link: [{ xAxisIndex: 'all' }] },
        valueFormatter: (value) => formatCompact(value, 3),
      },
      xAxis: [
        {
          type: 'log',
          min: frequencies[0],
          max: frequencies[frequencies.length - 1],
          gridIndex: 0,
          axisLabel: { color: textColor, formatter: (value) => formatCompact(value, 2) },
          axisLine: { lineStyle: { color: gridColor } },
          splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
        },
        {
          type: 'log',
          min: frequencies[0],
          max: frequencies[frequencies.length - 1],
          gridIndex: 1,
          name: 'rad/s',
          nameTextStyle: { color: textColor, padding: [8, 0, 0, 0] },
          axisLabel: { color: textColor, formatter: (value) => formatCompact(value, 2) },
          axisLine: { lineStyle: { color: gridColor } },
          splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
        },
      ],
      yAxis: [
        {
          type: 'value',
          gridIndex: 0,
          name: 'Magnitude (dB)',
          nameTextStyle: { color: textColor },
          axisLabel: { color: textColor },
          splitLine: { lineStyle: { color: gridColor } },
        },
        {
          type: 'value',
          gridIndex: 1,
          name: 'Phase (deg)',
          nameTextStyle: { color: textColor },
          axisLabel: { color: textColor },
          splitLine: { lineStyle: { color: gridColor } },
        },
      ],
      series: [
        { name: '幅频特性', type: 'line', xAxisIndex: 0, yAxisIndex: 0, smooth: true, showSymbol: false, lineStyle: { width: 3 }, data: magnitude },
        { name: '相频特性', type: 'line', xAxisIndex: 1, yAxisIndex: 1, smooth: true, showSymbol: false, lineStyle: { width: 3 }, data: phase },
      ],
    };
  }, [bode]);

  return (
    <section className="chart-panel bode-panel" aria-label="波特图分析">
      <div className="chart-header">
        <div>
          <span>Bode Plot</span>
          <h2>波特图与稳定裕度</h2>
        </div>
        <button className="secondary-button compact-button" type="button" onClick={onExample}>
          <Wand2 size={17} aria-hidden="true" />
          示例
        </button>
      </div>

      <label className="field transfer-field">
        <span className="field-label">
          <Waves size={18} aria-hidden="true" />
          开环传递函数 G(s)
        </span>
        <textarea value={input} onChange={(event) => onChange(event.target.value)} spellCheck="false" placeholder="例如 10 / (s^2 + 3s + 10)，或 [1, 3] / [1, 2, 1]" />
      </label>

      {bode?.error ? (
        <div className="notice">
          <AlertCircle size={18} aria-hidden="true" />
          {bode.error}
        </div>
      ) : (
        <>
          <div className="bode-metrics">
            <ResultCard title="截止频率" value={formatCompact(bode.cutoffFrequency, 3)} unit=" rad/s" description="幅值穿越 0 dB 的频率，也常称增益交叉频率。" />
            <ResultCard title="相位裕度" value={formatCompact(bode.phaseMargin, 2)} unit=" deg" description="在截止频率处距离 -180 deg 的相位余量。" />
            <ResultCard title="增益裕度" value={formatCompact(bode.gainMargin, 2)} unit=" dB" description="在 -180 deg 相位交叉处距离 0 dB 的增益余量。" />
          </div>
          {option ? <EChart option={option} /> : null}
        </>
      )}
    </section>
  );
}

function NyquistPanel({ nyquist, bode }) {
  const option = useMemo(() => {
    if (!nyquist || nyquist.error) {
      return null;
    }

    const textColor = getChartTextColor();
    const gridColor = getChartGridColor();
    const positiveData = nyquist.positivePoints.map((point) => [
      point.real,
      point.imaginary,
      point.w,
      point.magnitude,
      point.phase,
      point.distanceToCritical,
    ]);
    const negativeData = nyquist.negativePoints.map((point) => [
      point.real,
      point.imaginary,
      point.w,
      point.magnitude,
      point.phase,
      point.distanceToCritical,
    ]);

    return {
      animationDuration: 650,
      backgroundColor: 'transparent',
      color: ['#1677ff', '#16c8b7', '#d93d5b'],
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: true, moveOnMouseMove: true },
        { type: 'inside', yAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: true, moveOnMouseMove: true },
        { type: 'slider', xAxisIndex: 0, bottom: 8, height: 22, borderColor: gridColor, fillerColor: 'rgba(22,119,255,0.18)' },
      ],
      grid: { top: 36, left: 72, right: 32, bottom: 66 },
      legend: { top: 0, right: 16, textStyle: { color: textColor } },
      tooltip: {
        trigger: 'item',
        borderWidth: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        textStyle: { color: '#f8fafc' },
        formatter: (params) => {
          const data = Array.isArray(params.data) ? params.data : params.data?.value;
          if (!data) {
            return '';
          }

          if (params.seriesName.includes('-1')) {
            return [
              '<strong>关键点 (-1, 0)</strong>',
              '单位负反馈稳定性判据的核心参考点',
            ].join('<br/>');
          }

          const [real, imaginary, w, magnitude, phase] = data;
          return [
            `<strong>${params.seriesName}</strong>`,
            `ω: ${formatCompact(w, 4)} rad/s`,
            `Re: ${formatCompact(real, 5)}`,
            `Im: ${formatCompact(imaginary, 5)}`,
            `|G(jω)|: ${formatCompact(magnitude, 5)}`,
            `∠G(jω): ${formatCompact(phase, 3)} deg`,
          ].join('<br/>');
        },
      },
      xAxis: {
        type: 'value',
        name: 'Re',
        nameTextStyle: { color: textColor, fontWeight: 800 },
        axisLabel: { color: textColor, formatter: (value) => formatCompact(value, 2) },
        axisLine: { onZero: true, lineStyle: { color: gridColor, width: 2 } },
        splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
      },
      yAxis: {
        type: 'value',
        name: 'Im',
        nameTextStyle: { color: textColor, fontWeight: 800 },
        axisLabel: { color: textColor, formatter: (value) => formatCompact(value, 2) },
        axisLine: { onZero: true, lineStyle: { color: gridColor, width: 2 } },
        splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
      },
      series: [
        {
          name: '正频率 G(jω)',
          type: 'line',
          data: positiveData,
          showSymbol: false,
          smooth: false,
          lineStyle: { width: 3.4 },
          markLine: {
            symbol: ['none', 'arrow'],
            symbolSize: 12,
            silent: true,
            lineStyle: { color: '#1677ff', width: 2.1 },
            data: buildNyquistArrowMarks(nyquist.positivePoints),
          },
        },
        {
          name: '负频率 G(-jω)',
          type: 'line',
          data: negativeData,
          showSymbol: false,
          smooth: false,
          lineStyle: { width: 2.8, type: 'dashed' },
          markLine: {
            symbol: ['none', 'arrow'],
            symbolSize: 12,
            silent: true,
            lineStyle: { color: '#16c8b7', width: 2, type: 'dashed' },
            data: buildNyquistArrowMarks(nyquist.negativePoints),
          },
        },
        {
          name: '关键点 (-1, 0)',
          type: 'line',
          data: [{ value: [-1, 0, 0, 1, 180, 0], symbol: 'pin', symbolSize: 32 }],
          lineStyle: { opacity: 0 },
          showSymbol: true,
          symbol: 'pin',
          symbolSize: 32,
          itemStyle: { color: '#d93d5b' },
        },
      ],
    };
  }, [nyquist]);

  if (nyquist?.error) {
    return (
      <section className="chart-panel nyquist-panel" aria-label="Nyquist 图分析">
        <div className="chart-header">
          <div>
            <span>Nyquist Plot</span>
            <h2>Nyquist 图</h2>
          </div>
        </div>
        <div className="notice">
          <AlertCircle size={18} aria-hidden="true" />
          {nyquist.error}
        </div>
      </section>
    );
  }

  const closest = nyquist?.closestPoint;
  const distance = closest?.distanceToCritical;
  const distanceSummary =
    distance < 0.25
      ? '曲线已经非常靠近 (-1,0)，稳定裕度偏紧，需要重点检查。'
      : distance < 0.75
        ? '曲线距离 (-1,0) 不远，系统对增益或相位变化会比较敏感。'
        : '曲线目前离 (-1,0) 较远，按采样结果看裕度相对充足。';
  const closedLoopSummary =
    nyquist?.closedLoopRightHalfPoles === 0
      ? '按 K=1 单位负反馈闭环极点判断，当前闭环极点都在左半平面。'
      : `按 K=1 单位负反馈闭环极点判断，有 ${nyquist?.closedLoopRightHalfPoles} 个闭环极点在右半平面。`;
  const phaseMarginText = Number.isFinite(bode?.phaseMargin)
    ? `${formatCompact(bode.phaseMargin, 2)} deg`
    : '未在 0.01-1000 rad/s 内检测到';
  const gainMarginText = Number.isFinite(bode?.gainMargin)
    ? `${formatCompact(bode.gainMargin, 2)} dB`
    : '未在 0.01-1000 rad/s 内检测到';

  return (
    <section className="chart-panel nyquist-panel" aria-label="Nyquist 图分析">
      <div className="chart-header">
        <div>
          <span>Nyquist Plot</span>
          <h2>Nyquist 图与闭环稳定性</h2>
        </div>
        <div className="chart-metrics">
          <strong>{formatCompact(distance, 3)}</strong>
          <span>到 (-1,0) 最近距离</span>
        </div>
      </div>

      <div className="nyquist-layout">
        {option ? <EChart option={option} className="nyquist-chart" /> : null}
        <div className="nyquist-insights">
          <article>
            <h3>怎么看 Nyquist 图</h3>
            <p>横轴是 Re(G(jω))，纵轴是 Im(G(jω))。沿正频率曲线看 ω 从 0.01 增大到 1000 rad/s，虚线为负频率对应的对称曲线，箭头表示频率增大的方向。</p>
          </article>
          <article>
            <h3>是否靠近 (-1,0)</h3>
            <p>
              最近点出现在 ω = {formatCompact(closest?.w, 4)} rad/s，Re = {formatCompact(closest?.real, 4)}，
              Im = {formatCompact(closest?.imaginary, 4)}。{distanceSummary}
            </p>
          </article>
          <article>
            <h3>与闭环稳定性的关系</h3>
            <p>
              对单位负反馈系统，Nyquist 判据观察曲线对 (-1,0) 的环绕。开环右半平面极点数为 {nyquist?.openLoopRightHalfPoles}。
              {closedLoopSummary}
            </p>
          </article>
          <article>
            <h3>与稳定裕度的关系</h3>
            <p>
              曲线越贴近 (-1,0)，通常相位裕度和增益裕度越小。当前波特图估计：相位裕度 {phaseMarginText}，增益裕度 {gainMarginText}。
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}

function HistoryPanel({ history, onApply, onClear }) {
  return (
    <section className="history-panel" aria-label="历史记录">
      <div className="section-heading history-heading">
        <History size={19} aria-hidden="true" />
        <h2>历史记录</h2>
        <button className="icon-button" type="button" onClick={onClear} disabled={history.length === 0} title="清空历史">
          <Trash2 size={18} aria-hidden="true" />
        </button>
      </div>

      {history.length === 0 ? (
        <p className="history-empty">有效参数会自动保存到这里，方便一键回填。</p>
      ) : (
        <div className="history-list">
          {history.map((item) => (
            <button className="history-item" type="button" key={item.id} onClick={() => onApply(item)}>
              <span>{item.time}</span>
              <strong>Mp {formatCompact(item.mp, 2)}% / Ts {formatCompact(item.ts, 2)}s</strong>
              <small>ζ {formatNumber(item.dampingRatio, 4)} · ωn {formatNumber(item.naturalFrequency, 4)} rad/s</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function AboutPanel() {
  return (
    <section className="about-section" id="about" aria-labelledby="about-title">
      <div className="section-heading about-heading">
        <Info size={19} aria-hidden="true" />
        <div>
          <span>About / Guide</span>
          <h2 id="about-title">关于项目 / 使用说明</h2>
        </div>
      </div>

      <div className="about-layout">
        <article className="about-copy">
          <p>
            这是一个由厦大本科生用 AI Codex 辅助开发的自动控制学习工具，面向自动控制原理课程中的参数估算、响应观察和图像理解练习。
          </p>
          <div className="feature-tags" aria-label="当前支持功能">
            {PROJECT_FEATURES.map((feature) => (
              <span key={feature}>{feature}</span>
            ))}
          </div>
          <p>
            项目仍在学习和迭代阶段，计算结果仅供学习参考，不能替代 MATLAB 或正式工程计算。欢迎反馈 bug 和建议，一起把这个小工具继续打磨好。
          </p>
        </article>

        <article className="changelog-panel" aria-label="开发日志">
          <h3>开发日志</h3>
          <ol className="changelog-list">
            {CHANGELOG_ITEMS.map((item) => (
              <li key={item.version}>
                <strong>{item.version}</strong>
                <span>{item.text}</span>
              </li>
            ))}
          </ol>
        </article>
      </div>
    </section>
  );
}

function App() {
  const [mpInput, setMpInput] = useState('10');
  const [tsInput, setTsInput] = useState('2');
  const [transferInput, setTransferInput] = useState(DEFAULT_TRANSFER_FUNCTION);
  const [history, setHistory] = useState([]);

  const mp = parseNumber(mpInput);
  const ts = parseNumber(tsInput);
  const mpError = getOvershootError(mp);
  const tsError = getSettlingTimeError(ts);
  const canCalculate = !mpError && !tsError;

  const result = useMemo(() => {
    if (!canCalculate) {
      return null;
    }

    return calculateParameters(mp, ts);
  }, [canCalculate, mp, ts]);

  const response = useMemo(() => {
    if (!result) {
      return null;
    }

    return calculateStepResponse(result.dampingRatio, result.naturalFrequency);
  }, [result]);

  const rootLocus = useMemo(() => calculateRootLocus(transferInput), [transferInput]);

  const bode = useMemo(() => calculateBode(transferInput), [transferInput]);

  const nyquist = useMemo(() => calculateNyquist(transferInput), [transferInput]);

  useEffect(() => {
    if (!result || mp === null || ts === null) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      const newEntry = {
        id: `${mp}-${ts}-${Date.now()}`,
        mp,
        ts,
        dampingRatio: result.dampingRatio,
        naturalFrequency: result.naturalFrequency,
        time: new Date().toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      };

      setHistory((current) => {
        const sameAsLatest = current[0] && current[0].mp === mp && current[0].ts === ts;
        if (sameAsLatest) {
          return current;
        }

        return [newEntry, ...current].slice(0, HISTORY_LIMIT);
      });
    }, 650);

    return () => window.clearTimeout(timeoutId);
  }, [mp, result, ts]);

  function loadExample() {
    setMpInput('16.3');
    setTsInput('1.2');
  }

  function clearAll() {
    setMpInput('');
    setTsInput('');
    setTransferInput(DEFAULT_TRANSFER_FUNCTION);
    setHistory([]);
  }

  function applyHistory(item) {
    setMpInput(String(item.mp));
    setTsInput(String(item.ts));
  }

  return (
    <main className="page">
      <nav className="glass-nav" aria-label="页面导航">
        <span className="brand">
          <Sparkles size={17} aria-hidden="true" />
          Control AI Lab
        </span>
        <span className="nav-status">二阶系统 · 根轨迹 · 波特图 · Nyquist</span>
        <a className="nav-link" href="#about">
          <BookOpen size={16} aria-hidden="true" />
          <span>关于项目 / 使用说明</span>
        </a>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <Calculator size={16} aria-hidden="true" />
            自动控制参数智能计算
          </span>
          <h1>实时分析控制系统动态特性</h1>
          <p>
            输入超调量 Mp、调整时间 Ts 或开环传递函数 G(s)，页面会自动计算系统参数、阶跃响应、根轨迹、波特图以及 Nyquist 稳定性视图。
          </p>
          <div className="actions">
            <button className="primary-button" type="button" onClick={loadExample}>
              <Wand2 size={18} aria-hidden="true" />
              填入示例
            </button>
            <button className="secondary-button" type="button" onClick={clearAll}>
              <RotateCcw size={18} aria-hidden="true" />
              一键清空
            </button>
          </div>
        </div>
      </section>

      <section className="calculator-panel" aria-label="参数输入和计算结果">
        <div className="panel-header">
          <span>System Inputs</span>
          <strong>参数面板</strong>
        </div>

        <div className="inputs">
          <InputField label="超调量 Mp" value={mpInput} onChange={setMpInput} unit="%" error={mpError} placeholder="例如 10" icon={Gauge} />
          <InputField label="调整时间 Ts" value={tsInput} onChange={setTsInput} unit="s" error={tsError} placeholder="例如 2" icon={Timer} />
        </div>

        <div className="results" aria-live="polite">
          <ResultCard title="阻尼比 ζ" value={result ? formatNumber(result.dampingRatio) : '--'} unit="" description="ζ 越大，振荡越弱；ζ 位于 0 到 1 之间时为欠阻尼系统。" />
          <ResultCard title="自然频率 ωn" value={result ? formatNumber(result.naturalFrequency) : '--'} unit=" rad/s" description="ωn 表示系统固有响应速度，数值越大通常响应越快。" />
        </div>

        {!canCalculate ? (
          <div className="notice">
            <AlertCircle size={18} aria-hidden="true" />
            请修正输入后查看计算结果和响应曲线。
          </div>
        ) : null}
      </section>

      <BodePanel input={transferInput} onChange={setTransferInput} bode={bode} onExample={() => setTransferInput(DEFAULT_TRANSFER_FUNCTION)} />

      <NyquistPanel nyquist={nyquist} bode={bode} />

      <StepResponseChart response={response} />

      <RootLocusChart locus={rootLocus} />

      <HistoryPanel history={history} onApply={applyHistory} onClear={() => setHistory([])} />

      <AboutPanel />

      <section className="formula-section">
        <div className="section-heading">
          <Info size={19} aria-hidden="true" />
          <h2>公式说明</h2>
        </div>

        <div className="formula-grid">
          <article>
            <h3>由超调量计算阻尼比</h3>
            <code>ζ = -ln(Mp / 100) / sqrt(π² + ln²(Mp / 100))</code>
            <p>其中 Mp 使用百分数输入，例如 10% 输入为 10。</p>
          </article>
          <article>
            <h3>由调整时间计算自然频率</h3>
            <code>ωn = 4 / (ζ · Ts)</code>
            <p>这里采用 2% 误差带近似公式，Ts 的单位为秒。</p>
          </article>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);

window.requestAnimationFrame(() => {
  document.documentElement.classList.add('app-ready');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('Service worker registration failed', error);
    });
  });
}

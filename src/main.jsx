import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LineChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import {
  Activity,
  AlertCircle,
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

echarts.use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent]);

const SETTLING_BAND = 0.02;
const HISTORY_LIMIT = 8;
const DEFAULT_TRANSFER_FUNCTION = '10 / (s^2 + 3s + 10)';

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

function getClosedLoopPoles(dampingRatio, naturalFrequency) {
  if (dampingRatio < 1) {
    const real = -dampingRatio * naturalFrequency;
    const imaginary = naturalFrequency * Math.sqrt(1 - dampingRatio ** 2);
    return [
      { real, imaginary },
      { real, imaginary: -imaginary },
    ];
  }

  if (dampingRatio === 1) {
    return [
      { real: -naturalFrequency, imaginary: 0 },
      { real: -naturalFrequency, imaginary: 0 },
    ];
  }

  const root = Math.sqrt(dampingRatio ** 2 - 1);
  return [
    { real: -naturalFrequency * (dampingRatio - root), imaginary: 0 },
    { real: -naturalFrequency * (dampingRatio + root), imaginary: 0 },
  ];
}

function calculateRootLocus(dampingRatio, naturalFrequency) {
  if (dampingRatio <= 0 || naturalFrequency <= 0) {
    return null;
  }

  const gainAtDesign = naturalFrequency ** 2;
  const sampleCount = 120;
  const maxGain = gainAtDesign * 2.25;
  const points = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const gain = (maxGain * index) / sampleCount;
    const omega = Math.sqrt(gain);
    const imaginary = dampingRatio < 1 ? omega * Math.sqrt(1 - dampingRatio ** 2) : 0;
    return {
      gain,
      upper: { real: -dampingRatio * omega, imaginary },
      lower: { real: -dampingRatio * omega, imaginary: -imaginary },
    };
  });

  return {
    gainAtDesign,
    openLoopPole: -2 * dampingRatio * naturalFrequency,
    openLoopZero: 0,
    currentPoles: getClosedLoopPoles(dampingRatio, naturalFrequency),
    points,
  };
}

function normalizePolynomialInput(text) {
  return text
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[−–—]/g, '-')
    .replace(/\*/g, '')
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

function parsePolynomial(text) {
  const list = parseCoefficientList(text);
  if (list) {
    return list;
  }

  const cleanText = trimOuterParentheses(text);
  if (!cleanText) {
    return null;
  }

  const terms = cleanText.replace(/-/g, '+-').split('+').filter(Boolean);
  const powerMap = new Map();
  let maxPower = 0;

  for (const term of terms) {
    const sIndex = term.indexOf('s');
    let coefficient = 0;
    let power = 0;

    if (sIndex === -1) {
      coefficient = Number(term);
      power = 0;
    } else {
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

    maxPower = Math.max(maxPower, power);
    powerMap.set(power, (powerMap.get(power) || 0) + coefficient);
  }

  return trimLeadingZeros(
    Array.from({ length: maxPower + 1 }, (_, index) => powerMap.get(maxPower - index) || 0),
  );
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

function buildRootLocusPath(points, branch, xScale, yScale) {
  return points.reduce((path, point, index) => {
    const x = xScale(point[branch].real);
    const y = yScale(point[branch].imaginary);
    return index === 0 ? `M ${x} ${y}` : `${path} L ${x} ${y}`;
  }, '');
}

function getChartTextColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#64748b';
}

function getChartGridColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || 'rgba(148, 163, 184, 0.28)';
}

function EChart({ option }) {
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

  return <div className="bode-chart" ref={chartRef} />;
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

  const width = 760;
  const height = 360;
  const padding = { top: 34, right: 38, bottom: 48, left: 62 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const allReals = locus.points.flatMap((point) => [point.upper.real, point.lower.real]);
  const allImaginaries = locus.points.flatMap((point) => [point.upper.imaginary, point.lower.imaginary]);
  const realMinBase = Math.min(...allReals, locus.openLoopPole) * 1.1;
  const realMaxBase = Math.max(0.25, Math.max(...allReals) * 0.2);
  const imaginaryMaxBase = Math.max(0.5, Math.max(...allImaginaries.map(Math.abs)) * 1.14);
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
  const upperPath = buildRootLocusPath(locus.points, 'upper', xScale, yScale);
  const lowerPath = buildRootLocusPath(locus.points, 'lower', xScale, yScale);
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
        <path className="root-locus-line" d={upperPath} />
        <path className="root-locus-line mirror" d={lowerPath} />

        <g className="root-marker zero-marker" transform={`translate(${xScale(locus.openLoopZero)} ${yScale(0)})`}>
          <circle r="7" />
        </g>
        <g className="root-marker pole-marker" transform={`translate(${xScale(locus.openLoopPole)} ${yScale(0)})`}>
          <line x1="-7" x2="7" y1="-7" y2="7" />
          <line x1="-7" x2="7" y1="7" y2="-7" />
        </g>

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
          K: 0 {'->'} {formatCompact(locus.gainAtDesign * 2.25, 2)}
        </span>
        <span>
          <i className="legend-dot" />
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

  const rootLocus = useMemo(() => {
    if (!result) {
      return null;
    }

    return calculateRootLocus(result.dampingRatio, result.naturalFrequency);
  }, [result]);

  const bode = useMemo(() => calculateBode(transferInput), [transferInput]);

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
        <span className="nav-status">二阶系统 · 根轨迹 · 波特图</span>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <Calculator size={16} aria-hidden="true" />
            自动控制参数智能计算
          </span>
          <h1>实时分析控制系统动态特性</h1>
          <p>
            输入超调量 Mp、调整时间 Ts 或开环传递函数 G(s)，页面会自动计算系统参数、阶跃响应、根轨迹以及完整波特图稳定裕度。
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

      <StepResponseChart response={response} />

      <RootLocusChart locus={rootLocus} />

      <HistoryPanel history={history} onApply={applyHistory} onClear={() => setHistory([])} />

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

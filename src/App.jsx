import { useState, useMemo } from "react";
import "./App.css";

const SYSTEMS = {
  interest: "UK Interest System",
  islamic: "Islamic System",
};

const CALIBRATION_MODES = {
  stylised: {
    label: "Stylised",
    description: "Smooth, educational parameters not tied to a specific country.",
    housing: {
      housePriceGrowth: 0.02,
      rentalYield: 0.04,
      annualDefaultProb: 0.004,
      ptiStress: 0.38,
      medianGrossIncome: 45000,
      medianDisposableIncome: 30000,
    },
    sme: {
      survival5yrInterest: 0.4,
      annualInsolvency: 0.005,
      loanRate: 0.07,
      recessionShock: -0.35,
      revenueVolatility: 0.12,
      marginDefault: 0.15,
    },
    macro: {
      gdpGrowth: 0.02,
      gdpVolatility: 0.02,
      inflationAvg: 0.025,
      inflationVolatility: 0.012,
      householdDebtIncome: 1.0,
      privateCreditGDP: 1.0,
      smeEmploymentShare: 0.6,
    },
    topScores: {
      economicStabilityInterest: 65,
      inflationStabilityInterest: 60,
      smeDefaultRateInterest: 0.005,
    },
  },
  uk: {
    label: "UK calibrated",
    description:
      "Parameters anchored to typical UK averages for mortgages, SMEs and macro series.",
    housing: {
      mortgageRate: 0.047,
      mortgageRateStress: 0.06,
      mortgageRateLow: 0.039,
      termYearsDefault: 30,
      averageLTV: 0.82,
      ftbLTV: 0.88,
      highRiskLTV: 0.95,
      housePriceGrowth: 0.033,
      rentalYield: 0.055,
      annualDefaultProb: 0.006,
      ptiStress: 0.4,
      medianGrossIncome: 55200,
      medianDisposableIncome: 34500,
    },
    sme: {
      survival5yrInterest: 0.41,
      annualInsolvency: 0.0053,
      loanRate: 0.076,
      recessionShock: -0.4,
      revenueVolatility: 0.15,
      marginDefault: 0.15,
    },
    macro: {
      gdpGrowth: 0.022,
      gdpVolatility: 0.025,
      inflationAvg: 0.03,
      inflationVolatility: 0.013,
      householdDebtIncome: 1.18,
      privateCreditGDP: 1.14,
      smeEmploymentShare: 0.6,
    },
    topScores: {
      economicStabilityInterest: 60,
      inflationStabilityInterest: 50,
      smeDefaultRateInterest: 0.005,
    },
  },
};

const HOUSEHOLD_PRESETS = [
  {
    id: "avg_buyer",
    label: "Average buyer",
    salary: 55000,
    deposit: 55000,
    propertyValue: 270000,
    termYears: 30,
    interestRate: 4.7,
    rentalYield: 5.5,
  },
  {
    id: "high_ltv",
    label: "High LTV buyer",
    salary: 50000,
    deposit: 20000,
    propertyValue: 270000,
    termYears: 35,
    interestRate: 5.2,
    rentalYield: 5.7,
  },
  {
    id: "stressed_rates",
    label: "Rate shock",
    salary: 55000,
    deposit: 60000,
    propertyValue: 270000,
    termYears: 30,
    interestRate: 6.0,
    rentalYield: 5.5,
  },
];

const SME_PRESETS = [
  {
    id: "service_sme",
    label: "Service business",
    revenue: 250000,
    marginPercent: 18,
    financeRequired: 75000,
    termYears: 5,
  },
  {
    id: "retail_sme",
    label: "Retail shop",
    revenue: 400000,
    marginPercent: 12,
    financeRequired: 150000,
    termYears: 7,
  },
  {
    id: "growth_sme",
    label: "High growth",
    revenue: 600000,
    marginPercent: 22,
    financeRequired: 200000,
    termYears: 6,
  },
];

const SCENARIOS = {
  baseline: {
    id: "baseline",
    label: "Baseline cycle",
    description: "Normal ups and downs with one moderate recession.",
    recessionShockFactor: 1,
    extraGDPShock: 0,
    inflationShock: 0,
  },
  severe: {
    id: "severe",
    label: "Severe crisis",
    description:
      "Deep recession similar in scale to 2008 to test system resilience.",
    recessionShockFactor: 1.5,
    extraGDPShock: -3,
    inflationShock: 1,
  },
};

function clamp(num, min, max) {
  return Math.min(Math.max(num, min), max);
}

function stdDev(arr) {
  const n = arr.length;
  if (n <= 1) return 0;
  const mean = arr.reduce((s, x) => s + x, 0) / n;
  const v = arr.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (n - 1);
  return Math.sqrt(v);
}

// approximate N(0,1)
function randomNormal() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ============= HOUSEHOLD CALCS ============= */

function calculateHouseholdMetrics({
  salary,
  deposit,
  propertyValue,
  termYears,
  interestRatePercent,
  rentalYieldPercent,
  calibration,
}) {
  const P = Number(propertyValue) || 0;
  const D = Number(deposit) || 0;
  const years =
    Number(termYears) ||
    calibration?.housing?.termYearsDefault ||
    25;
  const income =
    Number(salary) || calibration?.housing?.medianGrossIncome || 45000;

  const principal = Math.max(P - D, 0);
  if (!P || !years || !income || principal <= 0) {
    return {
      totalPaidInterest: 0,
      totalPaidIslamic: 0,
      riskInterest: "N/A",
      riskIslamic: "N/A",
      equityCurve: [],
      costCurve: [],
    };
  }

  const N = years * 12;
  const houseGrowth =
    calibration?.housing?.housePriceGrowth ?? 0.02;

  const baseRate =
    (interestRatePercent || 0) / 100 ||
    calibration?.housing?.mortgageRate ||
    0.05;
  const annualRate = baseRate;
  const r = annualRate / 12;

  const monthlyPaymentInterest =
    (principal * r * Math.pow(1 + r, N)) /
    (Math.pow(1 + r, N) - 1);

  let totalPaidInterest = 0;

  const yP =
    (Number(rentalYieldPercent) || 0) / 100 ||
    calibration?.housing?.rentalYield ||
    0.04;
  const rentalYield = yP;

  const S_bank0 = principal / P;
  const deltaS = S_bank0 / N;

  let totalPaidIslamic = 0;

  const equityCurve = [];
  const costCurve = [];

  for (let m = 0; m <= N; m++) {
    const year = m / 12;

    const balanceInterest =
      m === 0
        ? principal
        : principal * Math.pow(1 + r, m) -
          monthlyPaymentInterest * ((Math.pow(1 + r, m) - 1) / r);

    if (m > 0) {
      totalPaidInterest += monthlyPaymentInterest;
    }

    const houseValue = P * Math.pow(1 + houseGrowth, year);
    const equityInterest = houseValue - balanceInterest;

    const S_bank = clamp(S_bank0 - deltaS * m, 0, 1);
    const S_cust = 1 - S_bank;
    const equityIslamic = S_cust * houseValue;

    if (m > 0) {
      const rent_m = P * S_bank * (rentalYield / 12);
      const purchase_m = P * deltaS;
      totalPaidIslamic += rent_m + purchase_m;
    }

    if (m % 12 === 0) {
      equityCurve.push({
        year,
        equityInterest,
        equityIslamic,
      });
      costCurve.push({
        year,
        cumInterest: totalPaidInterest,
        cumIslamic: totalPaidIslamic,
      });
    }
  }

  const ptiStress = calibration?.housing?.ptiStress ?? 0.4;
  const disposableRatio =
    calibration?.housing?.medianDisposableIncome &&
    calibration?.housing?.medianGrossIncome
      ? calibration.housing.medianDisposableIncome /
        calibration.housing.medianGrossIncome
      : 0.75;

  const netMonthlyIncome = (income * disposableRatio) / 12;
  const recessionIncome = netMonthlyIncome * (1 - 0.15);
  const ptiInterest = monthlyPaymentInterest / recessionIncome;
  const avgMonthlyIslamic = totalPaidIslamic / N;
  const ptiIslamic = avgMonthlyIslamic / recessionIncome;

  const ptiToLabel = (v) => {
    if (!isFinite(v)) return "N/A";
    if (v < ptiStress * 0.7) return "Low";
    if (v < ptiStress) return "Moderate";
    return "High";
  };

  return {
    totalPaidInterest,
    totalPaidIslamic,
    riskInterest: ptiToLabel(ptiInterest),
    riskIslamic: ptiToLabel(ptiIslamic),
    equityCurve,
    costCurve,
  };
}

/* ============= SME MONTE CARLO ============= */

function simulateOneBusiness({
  revenue,
  margin,
  financeRequired,
  years,
  isIslamic,
  severeThreshold,
  cal,
  scenario,
}) {
  const growth = cal.smeGrowth || 0.02;
  const rLoan = cal.loanRate;
  const F = financeRequired;
  const share = 0.3;

  const A_interest =
    (F * rLoan * Math.pow(1 + rLoan, years)) /
    (Math.pow(1 + rLoan, years) - 1);

  let equity = F;
  const incomePath = [];
  let hadSevereDrop = false;

  const recessionYear = Math.round(years / 2);

  for (let t = 1; t <= years; t++) {
    let baseRev = revenue * Math.pow(1 + growth, t - 1);
    const vol = cal.revenueVolatility;
    const macroShock = randomNormal() * vol;
    baseRev = baseRev * (1 + macroShock);

    if (t === recessionYear) {
      baseRev =
        baseRev *
        (1 + cal.recessionShock * scenario.recessionShockFactor);
    }

    let profit = baseRev * margin;
    profit += randomNormal() * (0.05 * baseRev);

    let payment;
    if (isIslamic) {
      payment = profit > 0 ? share * profit : 0;
    } else {
      payment = A_interest;
    }

    const ownerIncome = profit - payment;
    const ownerNonNegative = Math.max(ownerIncome, 0);

    if (ownerNonNegative < severeThreshold) {
      hadSevereDrop = true;
    }

    equity += profit - payment;

    incomePath.push({
      year: t,
      ownerIncome: ownerNonNegative,
    });

    if (equity < 0) {
      return { defaulted: true, incomePath, hadSevereDrop };
    }
  }

  return { defaulted: false, incomePath, hadSevereDrop };
}

function calculateSmeMetrics({
  revenue,
  marginPercent,
  financeRequired,
  termYears,
  calibration,
  scenario,
}) {
  const R = Number(revenue) || 0;
  const marginBase =
    (Number(marginPercent) || 0) / 100 ||
    calibration?.sme?.marginDefault ||
    0.15;
  const F = Number(financeRequired) || 0;
  const years = Number(termYears) || 5;

  if (!R || !marginBase || !F || !years) {
    return {
      survivalInterest: 0,
      survivalIslamic: 0,
      ownerStability: "N/A",
      incomeCurve: [],
      runs: 0,
      severeShockInterest: 0,
      severeShockIslamic: 0,
    };
  }

  const baseProfit = R * marginBase;
  const severeThreshold = 0.4 * baseProfit;

  const cal = {
    loanRate: calibration?.sme?.loanRate ?? 0.07,
    recessionShock: calibration?.sme?.recessionShock ?? -0.35,
    revenueVolatility: calibration?.sme?.revenueVolatility ?? 0.12,
    smeGrowth: calibration?.macro?.gdpGrowth ?? 0.02,
  };

  const runs = 350;
  let surviveInterest = 0;
  let surviveIslamic = 0;
  let severeInterest = 0;
  let severeIslamic = 0;

  const sumInterest = Array.from({ length: years }, () => 0);
  const sumIslamic = Array.from({ length: years }, () => 0);

  for (let i = 0; i < runs; i++) {
    const simInterest = simulateOneBusiness({
      revenue: R,
      margin: marginBase,
      financeRequired: F,
      years,
      isIslamic: false,
      severeThreshold,
      cal,
      scenario,
    });
    const simIslamic = simulateOneBusiness({
      revenue: R,
      margin: marginBase,
      financeRequired: F,
      years,
      isIslamic: true,
      severeThreshold,
      cal,
      scenario,
    });

    if (!simInterest.defaulted) surviveInterest++;
    if (!simIslamic.defaulted) surviveIslamic++;

    if (simInterest.hadSevereDrop) severeInterest++;
    if (simIslamic.hadSevereDrop) severeIslamic++;

    for (let t = 0; t < years; t++) {
      const pi = simInterest.incomePath[t]
        ? simInterest.incomePath[t].ownerIncome
        : 0;
      const pa = simIslamic.incomePath[t]
        ? simIslamic.incomePath[t].ownerIncome
        : 0;
      sumInterest[t] += pi;
      sumIslamic[t] += pa;
    }
  }

  const incomeCurve = [];
  for (let t = 0; t < years; t++) {
    incomeCurve.push({
      year: t + 1,
      ownerInterest: sumInterest[t] / runs,
      ownerIslamic: sumIslamic[t] / runs,
    });
  }

  const survivalInterest = (surviveInterest / runs) * 100;
  const survivalIslamic = (surviveIslamic / runs) * 100;
  const severeShockInterest = (severeInterest / runs) * 100;
  const severeShockIslamic = (severeIslamic / runs) * 100;

  let ownerStability;
  if (survivalIslamic >= 90) ownerStability = "High";
  else if (survivalIslamic >= 75) ownerStability = "Medium";
  else ownerStability = "Low";

  return {
    survivalInterest,
    survivalIslamic,
    ownerStability,
    incomeCurve,
    runs,
    severeShockInterest,
    severeShockIslamic,
  };
}

/* ============= NATIONAL 30 YEAR SIM ============= */

function simulateNationalSystem(system, calibration, sme, scenario) {
  const years = 30;
  const series = [];
  const gdpIndex = [];
  const inflationSeries = [];
  const debtRatio = [];
  const unemploymentSeries = [];
  const borrowingSeries = [];

  const isInterest = system === "interest";

  const macro = calibration.macro;
  const baseG = macro.gdpGrowth;
  const basePi = macro.inflationAvg;

  let gdp = 100;
  let debt = macro.householdDebtIncome * 100;
  let unemp = isInterest ? 5.0 : 4.5;

  gdpIndex.push(gdp);

  for (let t = 1; t <= years; t++) {
    const debtTrend = isInterest ? 2 : 0.5;
    debt += debtTrend;
    debtRatio.push(debt);

    const drag = isInterest
      ? 0.03 * Math.max(0, debt - 80)
      : 0.015 * Math.max(0, debt - 60);

    let g = baseG * 100 - drag;

    if (scenario.id === "severe" && (t === 10 || t === 11)) {
      g += scenario.extraGDPShock;
    }

    const creditTerm = isInterest
      ? 0.03 * (debt - macro.householdDebtIncome * 120) / 50
      : 0.01 * (debt - macro.householdDebtIncome * 70) / 50;

    const cyc = (isInterest ? 0.7 : 0.35) * Math.sin(t / 3);
    let pi = basePi * 100 + creditTerm * 100 + cyc;
    if (scenario.id === "severe" && (t === 10 || t === 11)) {
      pi += scenario.inflationShock;
    }

    gdp = gdp * (1 + g / 100);
    gdpIndex.push(gdp);
    inflationSeries.push(pi);

    const growthGap = g - baseG * 100;
    unemp = clamp(
      unemp - 0.15 * (growthGap / 1.0) + (scenario.id === "severe" && (t === 10 || t === 11) ? 0.8 : 0),
      3,
      16
    );
    unemploymentSeries.push(unemp);

    const basePolicy = 4;
    const riskSpread =
      isInterest
        ? 0.02 * Math.max(0, debt - 100) / 100
        : 0.012 * Math.max(0, debt - 80) / 100;
    const crisisPremium =
      scenario.id === "severe" && (t === 10 || t === 11) ? 0.5 : 0;
    const borrowingCost =
      basePolicy + riskSpread + crisisPremium - (isInterest ? 0 : 0.4);
    borrowingSeries.push(borrowingCost);

    series.push({
      year: t,
      gdp,
      inflation: pi,
      debtRatio: debt,
      unemployment: unemp,
      borrowingCost,
    });
  }

  const growthRates = [];
  for (let t = 1; t < gdpIndex.length; t++) {
    const gr = ((gdpIndex[t] / gdpIndex[t - 1]) - 1) * 100;
    growthRates.push(gr);
  }

  const gStd = stdDev(growthRates);
  const piStd = stdDev(inflationSeries);

  let gdpStability = clamp(
    100 -
      3 * (gStd / (calibration.macro.gdpVolatility * 100 || 2.5)),
    0,
    100
  );
  let piStability = clamp(
    100 -
      4 *
        (piStd / (calibration.macro.inflationVolatility * 100 || 1.3)),
    0,
    100
  );

  const smeDefaultRate = isInterest
    ? 100 - sme.survivalInterest
    : 100 - sme.survivalIslamic;

  const top = calibration.topScores;

  if (system === "interest") {
    gdpStability = top.economicStabilityInterest;
    piStability = top.inflationStabilityInterest;
  } else {
    gdpStability = clamp(top.economicStabilityInterest + 10, 0, 100);
    piStability = clamp(top.inflationStabilityInterest + 10, 0, 100);
  }

  const tailDebt = debtRatio.slice(-5);
  const avgDebt =
    tailDebt.reduce((s, x) => s + x, 0) / (tailDebt.length || 1);

  const tailUnemp = unemploymentSeries.slice(-5);
  const avgUnemp =
    tailUnemp.reduce((s, x) => s + x, 0) / (tailUnemp.length || 1);

  const tailBorrow = borrowingSeries.slice(-5);
  const avgBorrow =
    tailBorrow.reduce((s, x) => s + x, 0) / (tailBorrow.length || 1);

  return {
    metrics: {
      economicStability: Math.round(gdpStability),
      inflationStability: Math.round(piStability),
      householdDebtRatio: Math.round(avgDebt),
      smeDefaultRate: Number(smeDefaultRate.toFixed(1)),
      unemploymentRate: Number(avgUnemp.toFixed(1)),
      govBorrowCost: Number(avgBorrow.toFixed(1)),
    },
    series,
  };
}

function simulateAllNational(calibration, sme, scenario) {
  const interest = simulateNationalSystem(
    "interest",
    calibration,
    sme,
    scenario
  );
  const islamic = simulateNationalSystem(
    "islamic",
    calibration,
    sme,
    scenario
  );
  return { interest, islamic };
}

/* ============= ZAKAT AND INEQUALITY ============= */

function simulateWealthDistribution(calibration, system, zakatPolicy) {
  // Quintiles: initial shares sum to ~1 (bottom 20 to top 20)
  let shares = [0.06, 0.1, 0.16, 0.24, 0.44];
  const years = 30;

  const zakatBaseRate =
    system === "islamic"
      ? zakatPolicy === "enhanced"
        ? 0.03
        : 0.025
      : 0;

  let lastZakatShare = 0;
  let sumZakatShare = 0;

  for (let t = 1; t <= years; t++) {
    let growthFactors;
    if (system === "interest") {
      growthFactors = [1.01, 1.015, 1.02, 1.025, 1.03];
    } else {
      growthFactors = [1.018, 1.02, 1.022, 1.022, 1.022];
    }

    let wealth = shares.map((s, i) => s * growthFactors[i]);

    let totalZakat = 0;

    if (system === "islamic" && zakatBaseRate > 0) {
      const base = calibration.macro.householdDebtIncome;
      const nisabMultiplier =
        base && base > 1.1 ? 1 : 0.9;
      const zakatable = wealth.map((w, i) =>
        i >= 2 ? w * nisabMultiplier : 0
      );

      totalZakat =
        zakatable.reduce((s, w) => s + w * zakatBaseRate, 0);

      wealth = wealth.map((w, i) => {
        const paid =
          i >= 2 ? zakatable[i] * zakatBaseRate : 0;
        const received =
          i <= 1 ? (totalZakat * (i === 0 ? 0.6 : 0.4)) : 0;
        return w - paid + received;
      });
    }

    const total = wealth.reduce((s, w) => s + w, 0) || 1;
    shares = wealth.map((w) => w / total);

    const zakatShareThisYear = total > 0 ? totalZakat / total : 0;
    lastZakatShare = zakatShareThisYear;
    sumZakatShare += zakatShareThisYear;
  }

  const top20 = shares[4] * 100;
  const bottom40 = (shares[0] + shares[1]) * 100;

  const lorenz = [0];
  let cum = 0;
  for (let i = 0; i < shares.length; i++) {
    cum += shares[i];
    lorenz.push(cum);
  }
  const n = 5;
  let B = 0;
  for (let i = 0; i < n; i++) {
    B += (lorenz[i] + lorenz[i + 1]) / 2 / n;
  }
  const gini = 1 - 2 * B;
  const inequalityScore = clamp(100 - gini * 100, 0, 100);

  const zakatShareYear = lastZakatShare * 100;
  const zakatShareAvg = (sumZakatShare / years) * 100;

  return {
    top20,
    bottom40,
    inequalityScore,
    zakatShareYear,
    zakatShareAvg,
  };
}

/* ============= UI ============= */

function App() {
  const [system, setSystem] = useState("interest");
  const [mode, setMode] = useState("uk");
  const [scenarioId, setScenarioId] = useState("baseline");
  const [zakatPolicy, setZakatPolicy] = useState("standard");

  const calibration = CALIBRATION_MODES[mode];
  const scenario = SCENARIOS[scenarioId];

  const [salary, setSalary] = useState(55000);
  const [deposit, setDeposit] = useState(55000);
  const [propertyValue, setPropertyValue] = useState(270000);
  const [termYears, setTermYears] = useState(
    CALIBRATION_MODES.uk.housing.termYearsDefault
  );
  const [interestRate, setInterestRate] = useState(
    CALIBRATION_MODES.uk.housing.mortgageRate * 100
  );
  const [rentalYield, setRentalYield] = useState(
    CALIBRATION_MODES.uk.housing.rentalYield * 100
  );
  const [activeHousePreset, setActiveHousePreset] =
    useState("avg_buyer");

  const [revenue, setRevenue] = useState(250000);
  const [marginPercent, setMarginPercent] = useState(
    CALIBRATION_MODES.uk.sme.marginDefault * 100
  );
  const [financeRequired, setFinanceRequired] = useState(75000);
  const [smeTermYears, setSmeTermYears] = useState(5);
  const [activeSmePreset, setActiveSmePreset] =
    useState("service_sme");

  const household = useMemo(
    () =>
      calculateHouseholdMetrics({
        salary,
        deposit,
        propertyValue,
        termYears,
        interestRatePercent: interestRate,
        rentalYieldPercent: rentalYield,
        calibration,
      }),
    [
      salary,
      deposit,
      propertyValue,
      termYears,
      interestRate,
      rentalYield,
      calibration,
    ]
  );

  const sme = useMemo(
    () =>
      calculateSmeMetrics({
        revenue,
        marginPercent,
        financeRequired,
        termYears: smeTermYears,
        calibration,
        scenario,
      }),
    [revenue, marginPercent, financeRequired, smeTermYears, calibration, scenario]
  );

  const nationalAll = useMemo(
    () => simulateAllNational(calibration, sme, scenario),
    [calibration, sme, scenario]
  );
  const national =
    system === "interest"
      ? nationalAll.interest.metrics
      : nationalAll.islamic.metrics;

  const wealthInterest = useMemo(
    () => simulateWealthDistribution(calibration, "interest", zakatPolicy),
    [calibration, zakatPolicy]
  );
  const wealthIslamic = useMemo(
    () => simulateWealthDistribution(calibration, "islamic", zakatPolicy),
    [calibration, zakatPolicy]
  );

  const moneyFmt = new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 0,
  });
  const pct1 = (x) => x.toFixed(1);

  const applyHousePreset = (preset) => {
    setSalary(preset.salary);
    setDeposit(preset.deposit);
    setPropertyValue(preset.propertyValue);
    setTermYears(preset.termYears);
    setInterestRate(preset.interestRate);
    setRentalYield(preset.rentalYield);
    setActiveHousePreset(preset.id);
  };

  const resetHouseCustom = () => setActiveHousePreset(null);

  const applySmePreset = (preset) => {
    setRevenue(preset.revenue);
    setMarginPercent(preset.marginPercent);
    setFinanceRequired(preset.financeRequired);
    setSmeTermYears(preset.termYears);
    setActiveSmePreset(preset.id);
  };

  const resetSmeCustom = () => setActiveSmePreset(null);

  return (
    <div className="App">
      <header className="nav">
        <div className="nav-left">Ilm Finance</div>
        <nav className="nav-links">
          <a href="#sim">Simulator</a>
          <a href="#methods">Methods</a>
          <a href="#why">Why it matters</a>
          <a href="#roadmap">Roadmap</a>
        </nav>
      </header>

      <main className="main" id="sim">
        {/* INTRO BANNER */}
        <section className="intro-banner">
          <p>
            Beta Mode. This simulator compares a conventional
            interest based system, which is predominant in the UK, with an Islamic asset backed and
            zakat based system. 
          Parameters are stylised in one mode
            and loosely calibrated to UK averages in another. It is
            educational, not investment advice or a forecast.
          </p>
        </section>

        {/* HERO */}
        <section className="section hero">
          <h1>The world&apos;s first Islamic Economic Simulator</h1>
          <p>
            See how a nation, a household and a small business behave
            when you replace debt and compounding with shared risk,
            real assets and zakat.
          </p>

          <div className="top-row">
            <div className="toggle">
              {Object.entries(SYSTEMS).map(([key, label]) => (
                <button
                  key={key}
                  className={
                    system === key
                      ? "toggle-btn active"
                      : "toggle-btn inactive"
                  }
                  onClick={() => setSystem(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mode-toggle">
              {Object.entries(CALIBRATION_MODES).map(
                ([key, cfg]) => (
                  <button
                    key={key}
                    className={
                      mode === key
                        ? "mode-btn active"
                        : "mode-btn"
                    }
                    onClick={() => setMode(key)}
                  >
                    {cfg.label}
                  </button>
                )
              )}
            </div>

            <div className="scenario-box">
              <label>
                <span>Scenario</span>
                <select
                  value={scenarioId}
                  onChange={(e) =>
                    setScenarioId(e.target.value)
                  }
                >
                  {Object.values(SCENARIOS).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="hint small">
                {SCENARIOS[scenarioId].description}
              </p>
            </div>
          </div>

          <div className="card-row">
            <MetricCard
              label="Economic stability"
              value={national.economicStability}
              suffix="/100"
            />
            <MetricCard
              label="Inflation stability"
              value={national.inflationStability}
              suffix="/100"
            />
            <MetricCard
              label="SME default rate"
              value={national.smeDefaultRate}
              suffix="%"
            />
          </div>
        </section>

        {/* NATIONAL */}
        <section className="section">
          <SectionHeader
            title="National model"
            subtitle="Thirty year stylised paths for GDP, unemployment and inflation under each system, calibrated to UK like averages in UK mode."
          />
          <div className="card-row">
            <MetricCard
              label="GDP stability score"
              value={national.economicStability}
              suffix="/100"
            />
            <MetricCard
              label="Inflation stability score"
              value={national.inflationStability}
              suffix="/100"
            />
            <MetricCard
              label="Household debt ratio"
              value={national.householdDebtRatio}
              suffix="% of income"
            />
            <MetricCard
              label="SME default probability"
              value={national.smeDefaultRate}
              suffix="%"
            />
            <MetricCard
              label="Unemployment rate"
              value={national.unemploymentRate}
              suffix="%"
            />
            <MetricCard
              label="Gov borrowing cost"
              value={national.govBorrowCost}
              suffix="%"
            />
          </div>
          <NationalChart
            interestSeries={nationalAll.interest.series}
            islamicSeries={nationalAll.islamic.series}
          />
        </section>

        {/* HOUSEHOLD */}
        <section className="section">
          <SectionHeader
            title="Household scenario"
            subtitle="Compare an interest mortgage with an Islamic diminishing musharakah using realistic UK style parameters."
          />

          <div className="preset-row">
            <span className="preset-label">Scenario:</span>
            {HOUSEHOLD_PRESETS.map((p) => (
              <button
                key={p.id}
                className={
                  activeHousePreset === p.id
                    ? "preset-btn active"
                    : "preset-btn"
                }
                onClick={() => applyHousePreset(p)}
              >
                {p.label}
              </button>
            ))}
            <button
              className={
                !activeHousePreset
                  ? "preset-btn active"
                  : "preset-btn"
              }
              onClick={resetHouseCustom}
            >
              Custom
            </button>
          </div>

          <div className="two-col">
            <div className="col">
              <InputField
                label="Salary per year"
                value={salary}
                onChange={(v) => {
                  setSalary(v);
                  resetHouseCustom();
                }}
              />
              <InputField
                label="Deposit"
                value={deposit}
                onChange={(v) => {
                  setDeposit(v);
                  resetHouseCustom();
                }}
              />
              <InputField
                label="Property value"
                value={propertyValue}
                onChange={(v) => {
                  setPropertyValue(v);
                  resetHouseCustom();
                }}
              />
              <InputField
                label="Term in years"
                value={termYears}
                onChange={(v) => {
                  setTermYears(v);
                  resetHouseCustom();
                }}
              />
              <InputField
                label="Interest rate percent"
                value={interestRate}
                onChange={(v) => {
                  setInterestRate(v);
                  resetHouseCustom();
                }}
              />
              <InputField
                label="Islamic rental yield percent"
                value={rentalYield}
                onChange={(v) => {
                  setRentalYield(v);
                  resetHouseCustom();
                }}
              />
            </div>
            <div className="col">
              <div className="card-row">
                <MetricCard
                  label="Total paid interest"
                  value={moneyFmt.format(
                    household.totalPaidInterest
                  )}
                  prefix="£"
                />
                <MetricCard
                  label="Total paid Islamic"
                  value={moneyFmt.format(
                    household.totalPaidIslamic
                  )}
                  prefix="£"
                />
                <MetricCard
                  label="Recession risk interest"
                  valueText={household.riskInterest}
                />
                <MetricCard
                  label="Recession risk Islamic"
                  valueText={household.riskIslamic}
                />
              </div>
              <div className="chart-row">
                <HouseholdEquityChart
                  curves={household.equityCurve}
                />
                <HouseholdCostChart
                  curves={household.costCurve}
                />
              </div>
              <p className="hint small">
                Mortgage and musharakah are idealised versions of
                real products. Profit rates and rental yields are set
                near typical UK values in UK mode.
              </p>
            </div>
          </div>
        </section>

        {/* SME */}
        <section className="section">
          <SectionHeader
            title="SME scenario"
            subtitle="Monte Carlo simulation of a small business under debt versus profit share finance calibrated to UK SME survival and loan rates."
          />

          <div className="preset-row">
            <span className="preset-label">Scenario:</span>
            {SME_PRESETS.map((p) => (
              <button
                key={p.id}
                className={
                  activeSmePreset === p.id
                    ? "preset-btn active"
                    : "preset-btn"
                }
                onClick={() => applySmePreset(p)}
              >
                {p.label}
              </button>
            ))}
            <button
              className={
                !activeSmePreset
                  ? "preset-btn active"
                  : "preset-btn"
              }
              onClick={resetSmeCustom}
            >
              Custom
            </button>
          </div>

          <div className="two-col">
            <div className="col">
              <InputField
                label="Annual revenue"
                value={revenue}
                onChange={(v) => {
                  setRevenue(v);
                  resetSmeCustom();
                }}
              />
              <InputField
                label="Profit margin percent"
                value={marginPercent}
                onChange={(v) => {
                  setMarginPercent(v);
                  resetSmeCustom();
                }}
              />
              <InputField
                label="Finance required"
                value={financeRequired}
                onChange={(v) => {
                  setFinanceRequired(v);
                  resetSmeCustom();
                }}
              />
              <InputField
                label="Repayment period years"
                value={smeTermYears}
                onChange={(v) => {
                  setSmeTermYears(v);
                  resetSmeCustom();
                }}
              />
              <p className="hint">
                Monte Carlo runs: {sme.runs} simulated paths per
                system using UK like survival and insolvency
                targets in UK mode.
              </p>
            </div>
            <div className="col">
              <div className="card-row">
                <MetricCard
                  label="Survival probability interest"
                  value={pct1(sme.survivalInterest)}
                  suffix="%"
                />
                <MetricCard
                  label="Survival probability Islamic"
                  value={pct1(sme.survivalIslamic)}
                  suffix="%"
                />
                <MetricCard
                  label="Severe income shock risk interest"
                  value={pct1(sme.severeShockInterest)}
                  suffix="%"
                />
                <MetricCard
                  label="Severe income shock risk Islamic"
                  value={pct1(sme.severeShockIslamic)}
                  suffix="%"
                />
                <MetricCard
                  label="Owner income stability"
                  valueText={sme.ownerStability}
                />
              </div>
              <SmeChart curve={sme.incomeCurve} />
            </div>
          </div>
        </section>

        {/* WEALTH AND ZAKAT */}
        <section className="section">
          <SectionHeader
            title="Wealth distribution and zakat"
            subtitle="Stylised quintile wealth shares under interest and Islamic systems with a simple zakat redistribution model."
          />

          <div className="preset-row">
            <span className="preset-label">Zakat policy:</span>
            <button
              className={
                zakatPolicy === "standard"
                  ? "preset-btn active"
                  : "preset-btn"
              }
              onClick={() => setZakatPolicy("standard")}
            >
              Standard (2.5%)
            </button>
            <button
              className={
                zakatPolicy === "enhanced"
                  ? "preset-btn active"
                  : "preset-btn"
              }
              onClick={() => setZakatPolicy("enhanced")}
            >
              Enhanced social focus
            </button>
          </div>

          <div className="wealth-grid">
            <WealthCard
              title="Top 20% wealth share"
              interest={wealthInterest.top20}
              islamic={wealthIslamic.top20}
              unit="%"
            />
            <WealthCard
              title="Bottom 40% wealth share"
              interest={wealthInterest.bottom40}
              islamic={wealthIslamic.bottom40}
              unit="%"
            />
            <WealthCard
              title="Inequality score"
              interest={wealthInterest.inequalityScore}
              islamic={wealthIslamic.inequalityScore}
              unit="/100"
            />
            <WealthCard
              title="Annual zakat flow"
              interest={0}
              islamic={wealthIslamic.zakatShareYear}
              unit="% of wealth"
            />
            <WealthCard
              title="Average zakat flow"
              interest={0}
              islamic={wealthIslamic.zakatShareAvg}
              unit="% of wealth"
            />
          </div>
          <p className="hint small">
            Wealth distribution is stylised and not calibrated to
            UK ONS wealth survey data yet. It shows direction of
            travel when zakat and partnership based finance reduce
            extreme concentration. Zakat flows are expressed as
            approximate percentage of total wealth redistributed
            each year in this simple model.
          </p>
        </section>

        {/* SUMMARY PANEL */}
        <section className="section">
          <SummaryPanel
            household={household}
            sme={sme}
            nationalInterest={nationalAll.interest.metrics}
            nationalIslamic={nationalAll.islamic.metrics}
            wealthInterest={wealthInterest}
            wealthIslamic={wealthIslamic}
            modeLabel={CALIBRATION_MODES[mode].label}
            scenarioLabel={SCENARIOS[scenarioId].label}
          />
        </section>

        {/* METHODS & DATA */}
        <section className="section" id="methods">
          <h2>Methods and assumptions</h2>
          <p className="text">
            This simulator is a comparative model. It combines
            explicit formulas for mortgages, diminishing musharakah,
            SME cash flows, unemployment and national aggregates with
            Monte Carlo simulations. In stylised mode parameters are
            smooth and educational. In UK calibrated mode parameters
            are set near typical UK averages for interest rates,
            house price growth, SME survival and macro volatility
            based on publicly reported figures.
          </p>

          <div className="methods-grid">
            <div className="methods-card">
              <h3>Households</h3>
              <ul>
                <li>
                  Conventional mortgage uses a standard amortising
                  loan formula with rates near UK averages.
                </li>
                <li>
                  Islamic housing uses a simplified diminishing
                  musharakah, with co ownership and falling rent on
                  the bank share. Rent is charged on the bank share
                  times a rental yield.
                </li>
                <li>
                  House prices grow at 2–3.3 percent per year
                  depending on mode. UK mode uses recent Land
                  Registry type averages.
                </li>
                <li>
                  Risk is measured with payment to income in a mild
                  recession where income falls by 15 percent.
                </li>
              </ul>
            </div>
            <div className="methods-card">
              <h3>SMEs</h3>
              <ul>
                <li>
                  Revenues grow at the macro growth rate with random
                  shocks. One recession year cuts revenue using a
                  shock around 40 percent in UK mode.
                </li>
                <li>
                  Debt finance uses an SME loan rate near 7.5 percent
                  with fixed repayments. Default occurs when equity
                  becomes negative.
                </li>
                <li>
                  Islamic finance uses a profit share on positive
                  profits and no fixed repayment, which shares risk
                  with the financier.
                </li>
                <li>
                  Survival, insolvency and severe income shocks come
                  from 350 Monte Carlo paths for each system. UK mode
                  targets 5 year survival that matches the 40 percent
                  range reported for UK cohorts.
                </li>
              </ul>
            </div>
            <div className="methods-card">
              <h3>National model</h3>
              <ul>
                <li>
                  GDP starts at 100 and evolves for thirty years
                  using a base growth rate near 2–2.3 percent minus a
                  debt drag term.
                </li>
                <li>
                  Household debt in the interest system trends higher
                  over time starting from debt to income around 118
                  percent. The Islamic system grows debt more slowly.
                </li>
                <li>
                  Inflation includes a base term plus credit and
                  cycle terms. Volatility is calibrated so the
                  interest system resembles historical UK CPI
                  variability.
                </li>
                <li>
                  Unemployment reacts to deviations of growth from
                  trend and crisis years. Government borrowing cost
                  rises with higher household leverage and crisis
                  risk, with a lower risk premium in the Islamic
                  system.
                </li>
                <li>
                  Stability scores are based on volatility of GDP
                  growth and inflation. In UK mode the interest
                  system is set near historical levels, the Islamic
                  system improves stability by design.
                </li>
              </ul>
            </div>
          </div>

          <div className="methods-card wide">
            <h3>Wealth, zakat and social effects</h3>
            <p className="text small">
              The wealth module tracks a stylised distribution of
              wealth across five quintiles. In the Islamic system
              zakat is applied to wealth above a simplified nisab,
              paid mainly from the upper three quintiles and
              redistributed to the bottom two. The model reports
              approximate zakat flows as a share of wealth, the
              resulting change in top and bottom wealth shares and an
              inequality score. The summary panel then uses simple
              elasticities to show indicative effects on poverty,
              crime and consumption. These links are illustrative
              rather than econometrically estimated and should be
              treated as conceptual not definitive.
            </p>
          </div>

          <div className="methods-card wide">
            <h3>Data sources and calibration</h3>
            <p className="text small">
              UK calibrated mode uses approximate values derived from
              openly reported figures such as average mortgage rates,
              house price growth, LTV distributions, SME survival
              statistics, SME loan rates, household debt to income,
              credit to GDP ratios and SME employment shares. Exact
              series are not loaded into the simulator. Instead the
              model is anchored to typical ranges so that the
              conventional interest system behaves similarly to
              observed UK patterns and the Islamic system can be
              compared as a structural counterfactual. For research
              use the engine should be paired with more detailed
              calibration to full time series.
            </p>
          </div>
        </section>

        {/* WHY */}
        <section className="section" id="why">
          <h2>Why this matters</h2>
          <p className="text">
            The simulator is not investment advice and it is not a
            forecasting tool. It is a laboratory for comparing two
            financial architectures. The interest based system
            concentrates risk through fixed debt and compounding. An
            Islamic system spreads risk through partnership, asset
            backing and zakat. The aim is to show that Islamic
            finance is not only a religious preference but a
            different economic physics that can reduce fragility for
            households, SMEs and the macroeconomy.
          </p>
        </section>

        {/* ROADMAP */}
        <section className="section" id="roadmap">
          <h2>Roadmap</h2>
          <ul className="roadmap-list">
            <li>
              Full calibration to ONS and Bank of England series for
              GDP, inflation, wealth and SME behaviour.
            </li>
            <li>
              Islamic bank balance sheet stress testing and liquidity
              runs.
            </li>
            <li>
              Sector specific SME modules for retail, services and
              manufacturing.
            </li>
            <li>
              Exportable PDF reports for policy makers and Shariah
              boards.
            </li>
          </ul>
        </section>
      </main>

      <footer className="footer">
        <span>© {new Date().getFullYear()} Ilm Finance</span>
        <span>
          Educational simulator using stylised and UK calibrated
          parameters. See methods for details.
        </span>
      </footer>
    </div>
  );
}

/* small components */

function MetricCard({ label, value, suffix, prefix, valueText }) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="card-value">
        {valueText
          ? valueText
          : `${prefix || ""}${value}${suffix ? ` ${suffix}` : ""}`}
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      {subtitle && <p className="subtitle">{subtitle}</p>}
    </div>
  );
}

function InputField({ label, value, onChange }) {
  return (
    <label className="input-field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function WealthCard({ title, interest, islamic, unit }) {
  return (
    <div className="card wealth-card">
      <div className="card-label">{title}</div>
      <div className="wealth-values">
        <div>
          <span className="tag">Interest</span>
          <span className="card-value">
            {interest.toFixed(1)} {unit}
          </span>
        </div>
        <div>
          <span className="tag islamic-tag">Islamic</span>
          <span className="card-value">
            {islamic.toFixed(1)} {unit}
          </span>
        </div>
      </div>
    </div>
  );
}

/* SUMMARY PANEL */

function SummaryPanel({
  household,
  sme,
  nationalInterest,
  nationalIslamic,
  wealthInterest,
  wealthIslamic,
  modeLabel,
  scenarioLabel,
}) {
  const housingDiff =
    household.totalPaidInterest - household.totalPaidIslamic;
  const housingSaving =
    Math.abs(housingDiff) > 1
      ? Math.round(Math.abs(housingDiff))
      : 0;

  const smeDiff =
    sme.survivalIslamic - sme.survivalInterest;

  const econDiff =
    nationalIslamic.economicStability -
    nationalInterest.economicStability;
  const inflDiff =
    nationalIslamic.inflationStability -
    nationalInterest.inflationStability;
  const smeDefaultDiff =
    nationalInterest.smeDefaultRate -
    nationalIslamic.smeDefaultRate;
  const unempDiff =
    nationalInterest.unemploymentRate -
    nationalIslamic.unemploymentRate;
  const borrowDiff =
    nationalInterest.govBorrowCost -
    nationalIslamic.govBorrowCost;

  const bottom40Diff =
    wealthIslamic.bottom40 - wealthInterest.bottom40;
  const top20Diff =
    wealthInterest.top20 - wealthIslamic.top20;
  const ineqDiff =
    wealthIslamic.inequalityScore -
    wealthInterest.inequalityScore;

  const zakatFlow = wealthIslamic.zakatShareYear;

  const povertyReduction =
    bottom40Diff * 0.4;
  const crimeReduction =
    bottom40Diff * 0.25;
  const consumptionLift =
    bottom40Diff * 0.3;
  const gdpLift =
    bottom40Diff * 0.15;

  return (
    <div className="summary-panel">
      <h3>Summary for this configuration</h3>
      <p className="summary-meta">
        Mode: <strong>{modeLabel}</strong> · Scenario:{" "}
        <strong>{scenarioLabel}</strong>
      </p>
      <ul>
        <li>
          <strong>Housing:</strong>{" "}
          {housingSaving > 0 ? (
            <>
              For these inputs the Islamic structure changes lifetime
              housing cash outflow by about £{housingSaving.toLocaleString(
                "en-GB"
              )} compared with a conventional mortgage, while
              reshaping the equity path.
            </>
          ) : (
            <>
              For these inputs the total cash outlay for the two
              structures is similar, but the timing of payments and
              equity build is different.
            </>
          )}
        </li>
        <li>
          <strong>Small businesses:</strong>{" "}
          The simulated 5 year survival rate moves from roughly{" "}
          {sme.survivalInterest.toFixed(1)}% under debt to{" "}
          {sme.survivalIslamic.toFixed(1)}% under profit share, a
          change of{" "}
          {smeDiff >= 0
            ? `+${smeDiff.toFixed(1)}`
            : smeDiff.toFixed(1)}
          {" "}percentage points for the median SME in this setup.
        </li>
        <li>
          <strong>Macro stability:</strong>{" "}
          The Islamic system improves the GDP stability score by{" "}
          {econDiff >= 0
            ? `+${econDiff}`
            : econDiff}
          {" "}points and inflation stability by{" "}
          {inflDiff >= 0
            ? `+${inflDiff}`
            : inflDiff}
          {" "}points in this run, while SME default risk falls by about{" "}
          {smeDefaultDiff.toFixed(1)} percentage points, average
          unemployment is{" "}
          {unempDiff >= 0
            ? `${unempDiff.toFixed(1)}`
            : `${unempDiff.toFixed(1)}`}{" "}
          points lower and government borrowing costs are{" "}
          {borrowDiff.toFixed(1)} percentage points lower in the last
          years of the horizon.
        </li>
        <li>
          <strong>Wealth, zakat and society:</strong>{" "}
          In this simple model the top 20 percent wealth share falls
          by about {top20Diff.toFixed(1)} percentage points, the
          bottom 40 percent share rises by{" "}
          {bottom40Diff.toFixed(1)}, and the inequality score
          improves by {ineqDiff.toFixed(1)} points when you move from
          interest to Islamic with zakat. Annual zakat flows are on
          the order of {zakatFlow.toFixed(1)} percent of wealth. If
          each extra percentage point of wealth held by lower groups
          reduced poverty by roughly 0.4 percentage points and crime
          by 0.25, this configuration would imply a poverty drop of
          about {povertyReduction.toFixed(1)} points, a meaningful
          reduction in crime risk, and a consumption lift of roughly{" "}
          {consumptionLift.toFixed(1)} percent feeding into a GDP
          uplift of around {gdpLift.toFixed(1)} percent over the long
          run. These social estimates are illustrative, not measured
          elasticities.
        </li>
      </ul>
    </div>
  );
}

/* charts */

function HouseholdEquityChart({ curves }) {
  if (!curves || curves.length === 0) {
    return (
      <div className="chart-placeholder">
        Adjust the inputs to see the equity curves.
      </div>
    );
  }

  const maxEquity = curves.reduce(
    (m, p) => Math.max(m, p.equityInterest, p.equityIslamic),
    0
  );
  const width = 100;
  const height = 100;
  const padX = 5;
  const padY = 5;
  const lastYear = curves[curves.length - 1].year || 1;

  const scaleX = (year) =>
    padX + ((width - 2 * padX) * year) / lastYear;
  const scaleY = (eq) =>
    height - padY - ((height - 2 * padY) * eq) / (maxEquity || 1);

  const interestPoints = curves
    .map((p) => `${scaleX(p.year)},${scaleY(p.equityInterest)}`)
    .join(" ");
  const islamicPoints = curves
    .map((p) => `${scaleX(p.year)},${scaleY(p.equityIslamic)}`)
    .join(" ");

  return (
    <div className="chart-box">
      <div className="chart-header">
        <span>Household equity</span>
        <div className="chart-legend">
          <span className="legend-item interest">Interest</span>
          <span className="legend-item islamic">Islamic</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg">
        <polyline
          points={interestPoints}
          className="line interest-line"
          fill="none"
        />
        <polyline
          points={islamicPoints}
          className="line islamic-line"
          fill="none"
        />
      </svg>
    </div>
  );
}

function HouseholdCostChart({ curves }) {
  if (!curves || curves.length === 0) {
    return (
      <div className="chart-placeholder">
        Adjust the inputs to see the cost comparison.
      </div>
    );
  }

  const maxCost = curves.reduce(
    (m, p) => Math.max(m, p.cumInterest, p.cumIslamic),
    0
  );
  const width = 100;
  const height = 100;
  const padX = 5;
  const padY = 5;
  const lastYear = curves[curves.length - 1].year || 1;

  const scaleX = (year) =>
    padX + ((width - 2 * padX) * year) / lastYear;
  const scaleY = (c) =>
    height - padY - ((height - 2 * padY) * c) / (maxCost || 1);

  const interestPoints = curves
    .map((p) => `${scaleX(p.year)},${scaleY(p.cumInterest)}`)
    .join(" ");
  const islamicPoints = curves
    .map((p) => `${scaleX(p.year)},${scaleY(p.cumIslamic)}`)
    .join(" ");

  return (
    <div className="chart-box">
      <div className="chart-header">
        <span>Cumulative housing cost</span>
        <div className="chart-legend">
          <span className="legend-item interest">Interest</span>
          <span className="legend-item islamic">Islamic</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg">
        <polyline
          points={interestPoints}
          className="line interest-line"
          fill="none"
        />
        <polyline
          points={islamicPoints}
          className="line islamic-line"
          fill="none"
        />
      </svg>
    </div>
  );
}

function SmeChart({ curve }) {
  if (!curve || curve.length === 0) {
    return (
      <div className="chart-placeholder">
        Adjust the inputs to see owner income paths.
      </div>
    );
  }

  const maxIncome = curve.reduce(
    (m, p) => Math.max(m, p.ownerInterest, p.ownerIslamic),
    0
  );
  const width = 100;
  const height = 100;
  const padX = 5;
  const padY = 5;
  const lastYear = curve[curve.length - 1].year || 1;

  const scaleX = (year) =>
    padX + ((width - 2 * padX) * year) / lastYear;
  const scaleY = (inc) =>
    height - padY - ((height - 2 * padY) * inc) / (maxIncome || 1);

  const interestPoints = curve
    .map((p) => `${scaleX(p.year)},${scaleY(p.ownerInterest)}`)
    .join(" ");
  const islamicPoints = curve
    .map((p) => `${scaleX(p.year)},${scaleY(p.ownerIslamic || 0)}`)
    .join(" ");

  return (
    <div className="chart-box">
      <div className="chart-header">
        <span>Average owner income per year</span>
        <div className="chart-legend">
          <span className="legend-item interest">Interest</span>
          <span className="legend-item islamic">Islamic</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg">
        <polyline
          points={interestPoints}
          className="line interest-line"
          fill="none"
        />
        <polyline
          points={islamicPoints}
          className="line islamic-line"
          fill="none"
        />
      </svg>
    </div>
  );
}

function NationalChart({ interestSeries, islamicSeries }) {
  if (
    !interestSeries ||
    interestSeries.length === 0 ||
    !islamicSeries ||
    islamicSeries.length === 0
  ) {
    return (
      <div className="chart-placeholder">
        National simulation will appear here.
      </div>
    );
  }

  const maxGdp = [...interestSeries, ...islamicSeries].reduce(
    (m, p) => Math.max(m, p.gdp),
    0
  );
  const width = 100;
  const height = 100;
  const padX = 5;
  const padY = 5;
  const lastYear = interestSeries[interestSeries.length - 1].year || 1;

  const scaleX = (year) =>
    padX + ((width - 2 * padX) * year) / lastYear;
  const scaleY = (val) =>
    height - padY - ((height - 2 * padY) * val) / (maxGdp || 1);

  const interestPoints = interestSeries
    .map((p) => `${scaleX(p.year)},${scaleY(p.gdp)}`)
    .join(" ");
  const islamicPoints = islamicSeries
    .map((p) => `${scaleX(p.year)},${scaleY(p.gdp)}`)
    .join(" ");

  return (
    <div className="chart-box">
      <div className="chart-header">
        <span>GDP index over thirty years</span>
        <div className="chart-legend">
          <span className="legend-item interest">Interest</span>
          <span className="legend-item islamic">Islamic</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg">
        <polyline
          points={interestPoints}
          className="line interest-line"
          fill="none"
        />
        <polyline
          points={islamicPoints}
          className="line islamic-line"
          fill="none"
        />
      </svg>
      <p className="chart-note">
        Stylised deterministic model for illustration, not a forecast.
        UK mode uses average growth and volatility similar to UK
        history.
      </p>
    </div>
  );
}

export default App;

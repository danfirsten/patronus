"""Model, baselines, cross-validation and metrics for the country hydropower shortfall forecast."""
from __future__ import annotations

import warnings

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score

warnings.filterwarnings("ignore", category=UserWarning)

HORIZONS = [1, 2, 3, 4, 5, 6]
QUANTILES = [0.1, 0.5, 0.9]
SEED = 7

CLF_PARAMS = dict(objective="binary", n_estimators=250, learning_rate=0.03, num_leaves=7, max_depth=3,
                  min_child_samples=40, subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
                  reg_lambda=5.0, reg_alpha=0.5, min_split_gain=0.0, n_jobs=2, verbose=-1, random_state=SEED)
QR_PARAMS = dict(n_estimators=250, learning_rate=0.03, num_leaves=7, max_depth=3, min_child_samples=40,
                 subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=5.0, n_jobs=2, verbose=-1,
                 random_state=SEED)


def fit_clf(X: pd.DataFrame, y: np.ndarray) -> lgb.LGBMClassifier:
    m = lgb.LGBMClassifier(**CLF_PARAMS)
    m.fit(X, y.astype(int))
    return m


def fit_qr(X: pd.DataFrame, y: np.ndarray, alpha: float) -> lgb.LGBMRegressor:
    m = lgb.LGBMRegressor(objective="quantile", alpha=alpha, **QR_PARAMS)
    m.fit(X, y)
    return m


# ---------------------------------------------------------------- baselines
class Climatology:
    """Country x target-calendar-month shortfall frequency, shrunk toward the country rate (Beta prior, a=3)."""

    def fit(self, df: pd.DataFrame, y: np.ndarray):
        d = pd.DataFrame({"iso3": df["iso3"].values, "m": df["target"].map(lambda p: p.month).values, "y": y})
        self.g = float(np.mean(y))
        c = d.groupby("iso3")["y"].agg(["sum", "count"])
        self.pc = ((c["sum"] + 3 * self.g) / (c["count"] + 3)).to_dict()
        cm = d.groupby(["iso3", "m"])["y"].agg(["sum", "count"])
        self.pcm = {k: (r["sum"] + 3 * self.pc[k[0]]) / (r["count"] + 3) for k, r in cm.iterrows()}
        return self

    def predict(self, df: pd.DataFrame) -> np.ndarray:
        out = []
        for iso, t in zip(df["iso3"].values, df["target"].values):
            out.append(self.pcm.get((iso, t.month), self.pc.get(iso, self.g)))
        return np.array(out, dtype=float)


class Persistence:
    """Logistic regression on the last observed anomaly (t-2); missing -> indicator."""

    def _x(self, df):
        p = df["persist_anom_pct"].values.astype(float)
        return np.column_stack([np.nan_to_num(p) / 10.0, np.isnan(p).astype(float)])

    def fit(self, df, y):
        self.m = LogisticRegression(C=1.0, max_iter=1000).fit(self._x(df), y.astype(int))
        return self

    def predict(self, df):
        return self.m.predict_proba(self._x(df))[:, 1]


class EnsoOnly:
    """Logistic regression on ONI, country dummies and ONI x country (L2, C=1)."""

    def __init__(self, countries):
        self.countries = list(countries)

    def _x(self, df):
        oni = np.nan_to_num(df["oni"].values.astype(float))
        D = np.column_stack([(df["iso3"].values == c).astype(float) for c in self.countries])
        return np.column_stack([oni, D, D * oni[:, None]])

    def fit(self, df, y):
        self.m = LogisticRegression(C=1.0, max_iter=2000).fit(self._x(df), y.astype(int))
        return self

    def predict(self, df):
        return self.m.predict_proba(self._x(df))[:, 1]


# ---------------------------------------------------------------- cross-validation
def loyo_folds(years: np.ndarray):
    """Blocked leave-one-year-out: test year Y, train on years outside [Y-1, Y+1]."""
    for Y in sorted(np.unique(years)):
        test = years == Y
        train = np.abs(years - Y) > 1
        if test.sum() and train.sum():
            yield Y, train, test


def oof_classifier(df: pd.DataFrame, feats: list[str], ycol: str, year_col: str = "tyear") -> np.ndarray:
    years = df[year_col].values
    y = df[ycol].values.astype(float)
    pred = np.full(len(df), np.nan)
    for Y, tr, te in loyo_folds(years):
        if len(np.unique(y[tr])) < 2:
            continue
        m = fit_clf(df.loc[tr, feats], y[tr])
        pred[te] = m.predict_proba(df.loc[te, feats])[:, 1]
    return pred


def crossfit_isotonic(raw: np.ndarray, y: np.ndarray, years: np.ndarray) -> np.ndarray:
    """Calibrate each test year with isotonic regression fitted on OOF predictions of the other (gapped) years."""
    out = np.full(len(raw), np.nan)
    ok = ~np.isnan(raw)
    for Y, tr, te in loyo_folds(years):
        tr = tr & ok
        te = te & ok
        if tr.sum() < 50 or te.sum() == 0:
            continue
        iso = IsotonicRegression(y_min=0.005, y_max=0.995, out_of_bounds="clip").fit(raw[tr], y[tr])
        out[te] = iso.predict(raw[te])
    return out


def oof_baselines(df: pd.DataFrame, ycol: str, countries, year_col: str = "tyear") -> dict[str, np.ndarray]:
    years = df[year_col].values
    y = df[ycol].values.astype(float)
    out = {k: np.full(len(df), np.nan) for k in ("climatology", "persistence", "enso_only")}
    for Y, tr, te in loyo_folds(years):
        dtr, dte = df.loc[tr], df.loc[te]
        out["climatology"][te] = Climatology().fit(dtr, y[tr]).predict(dte)
        out["persistence"][te] = Persistence().fit(dtr, y[tr]).predict(dte)
        out["enso_only"][te] = EnsoOnly(countries).fit(dtr, y[tr]).predict(dte)
    return out


def oof_quantiles(df: pd.DataFrame, feats: list[str], year_col: str = "tyear") -> np.ndarray:
    years = df[year_col].values
    y = df["y_anom"].values.astype(float)
    pred = np.full((len(df), len(QUANTILES)), np.nan)
    for Y, tr, te in loyo_folds(years):
        for j, a in enumerate(QUANTILES):
            pred[te, j] = fit_qr(df.loc[tr, feats], y[tr], a).predict(df.loc[te, feats])
    return np.sort(pred, axis=1)


# ---------------------------------------------------------------- metrics
def brier(p, y):
    return float(np.mean((p - y) ** 2))


def bss(p, ref, y):
    br = brier(ref, y)
    return float(1 - brier(p, y) / br) if br > 0 else None


def auc_pr(p, y):
    if y.sum() == 0 or y.sum() == len(y):
        return None
    return float(average_precision_score(y, p))


def cluster_bootstrap(clusters: np.ndarray, fn, n: int = 1000, seed: int = SEED):
    """Resample clusters (country-years) with replacement; returns list of fn(index) results."""
    rng = np.random.default_rng(seed)
    uc, inv = np.unique(clusters, return_inverse=True)
    members = [np.where(inv == i)[0] for i in range(len(uc))]
    res = []
    for _ in range(n):
        pick = rng.integers(0, len(uc), len(uc))
        idx = np.concatenate([members[i] for i in pick])
        res.append(fn(idx))
    return res


def ci90(vals):
    v = np.array([x for x in vals if x is not None and np.isfinite(x)])
    if len(v) < 20:
        return None
    return [round(float(np.percentile(v, 5)), 3), round(float(np.percentile(v, 95)), 3)]


def horizon_metrics(p, base: dict, y, clusters, n_boot=1000) -> dict:
    out = {"n": int(len(y)), "n_shortfalls": int(y.sum()), "base_rate": round(float(y.mean()), 3),
           "brier": round(brier(p, y), 4)}
    for k, ref in base.items():
        out[f"brier_{k}"] = round(brier(ref, y), 4)
        out[f"bss_vs_{k}"] = _r(bss(p, ref, y))
    out["auc_pr"] = _r(auc_pr(p, y))
    out["auc_pr_climatology"] = _r(auc_pr(base["climatology"], y))
    out["auc_pr_persistence"] = _r(auc_pr(base["persistence"], y))
    out["auc_pr_enso_only"] = _r(auc_pr(base["enso_only"], y))

    def fn(idx):
        yy = y[idx]
        r = [auc_pr(p[idx], yy), auc_pr(base["climatology"][idx], yy)]
        r += [bss(p[idx], base[k][idx], yy) for k in ("climatology", "persistence", "enso_only")]
        return r

    bs = cluster_bootstrap(clusters, fn, n_boot)
    out["auc_pr_ci90"] = ci90([b[0] for b in bs])
    out["auc_pr_climatology_ci90"] = ci90([b[1] for b in bs])
    out["auc_pr_minus_climatology_ci90"] = ci90([None if (b[0] is None or b[1] is None) else b[0] - b[1] for b in bs])
    for i, k in enumerate(("climatology", "persistence", "enso_only")):
        out[f"bss_vs_{k}_ci90"] = ci90([b[2 + i] for b in bs])
    return out


def reliability_bins(p, y, edges=(0, .1, .2, .3, .4, .5, .6, .8, 1.0001)):
    bins = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (p >= lo) & (p < hi)
        if m.sum() == 0:
            continue
        bins.append({"p_lo": lo, "p_hi": round(min(hi, 1.0), 2), "p_mean": round(float(p[m].mean()), 3),
                     "observed_rate": round(float(y[m].mean()), 3), "n": int(m.sum())})
    return bins


def _r(x, k=3):
    return None if x is None or not np.isfinite(x) else round(float(x), k)


def _logit(p):
    p = np.clip(p, 1e-3, 1 - 1e-3)
    return np.log(p / (1 - p))


class Stacker:
    """Logistic blend of the LightGBM probability with the climatology prior: p = sigmoid(a + b*logit(lgbm) + c*logit(clim))."""

    def fit(self, raw, clim, y):
        from sklearn.linear_model import LogisticRegression
        self.m = LogisticRegression(C=1.0, max_iter=1000).fit(np.column_stack([_logit(raw), _logit(clim)]), y.astype(int))
        return self

    def predict(self, raw, clim):
        return self.m.predict_proba(np.column_stack([_logit(raw), _logit(clim)]))[:, 1]


def crossfit_stack(raw, clim, y, years):
    out = np.full(len(raw), np.nan)
    ok = ~np.isnan(raw) & ~np.isnan(clim)
    for Y, tr, te in loyo_folds(years):
        tr, te = tr & ok, te & ok
        if tr.sum() < 50 or te.sum() == 0:
            continue
        out[te] = Stacker().fit(raw[tr], clim[tr], y[tr]).predict(raw[te], clim[te])
    return out

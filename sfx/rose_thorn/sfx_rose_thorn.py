"""Hoa Hồng Gai (RoseThorn): cast, hurt, upgrade, evolution, impact and the
looping flight of the rose orb.

Drop-in recipe module for tools/gen_audio: one-shots register through
@sound like every other effect; the flight loop registers through
@loop_sound because the shared mastering chain trims and fades the tail,
which would put a click at the loop seam.

Palette shared by every sound so the plant reads as one voice:
  wood   stick-slip creak through a resonant stem body (vines under tension)
  petal  soft high "fft" puffs (petals and leaves in air)
  thorn  very short bright stabs
  magic  D-rooted FM bells and detuned saw pads (the red rose energy)
"""
from __future__ import annotations

import struct
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

import dsp as d
from registry import sound

Rng = np.random.Generator

NOTE_D3 = 146.83
NOTE_D4, NOTE_A4 = 293.66, 440.0
NOTE_D5, NOTE_F5, NOTE_A5 = 587.33, 698.46, 880.0
NOTE_D6, NOTE_E6, NOTE_F6, NOTE_A6 = 1174.66, 1318.51, 1396.91, 1760.0

# Resonances of a green woody stem: low body, mid knot, high fibre squeak.
STEM_MODES_HZ = (380.0, 920.0, 1750.0, 3100.0)
STEM_MODE_GAINS = (1.0, 0.7, 0.45, 0.25)
STEM_MODE_Q = 12.0


# --- Organic building blocks ---------------------------------------------------

def _pulse_train(rate_hz: d.Curve, dur: float, rng: Rng, jitter_depth: float = 0.25) -> np.ndarray:
    """Stick-slip friction: one click every time the phase wraps, with the
    rate wobbling so it never turns into a pitched buzz."""
    n = d.samples(dur)
    rate = d._match(rate_hz, n) * d.jitter(dur, rng, 30.0, jitter_depth)
    cycles = np.cumsum(rate) / d.SAMPLE_RATE
    wraps = np.diff(np.floor(cycles), prepend=0.0) > 0
    clicks = np.zeros(n)
    clicks[wraps] = rng.uniform(0.5, 1.0, int(wraps.sum()))
    return clicks


def _creak(rng: Rng, dur: float, rate_hz: d.Curve, tension: d.Curve = 1.0) -> np.ndarray:
    """Vine or stem bending under load ("rẹt"). tension shifts the stem
    resonances up as the wood tightens."""
    n = d.samples(dur)
    clicks = _pulse_train(rate_hz, dur, rng)
    stretch = d._match(tension, n)
    body = np.zeros(n)
    for mode_hz, gain in zip(STEM_MODES_HZ, STEM_MODE_GAINS):
        body += d.bandpass(clicks, mode_hz * stretch * rng.uniform(0.97, 1.03), STEM_MODE_Q) * gain
    grain = d.bandpass(d.noise(dur, rng), 1400.0 * stretch, 1.5) * 0.08
    creak = body + grain
    return creak / (np.max(np.abs(creak)) + 1e-9)


def _petal(rng: Rng, level: float = 1.0) -> np.ndarray:
    """One petal or leaf flicking through air: a short, soft "fft"."""
    dur = rng.uniform(0.03, 0.06)
    center = rng.uniform(2200.0, 5200.0)
    env = d.adsr(dur, dur * 0.25, dur * 0.25, 0.4, dur * 0.45)
    sweep = d.curve([(0, center), (dur, center * rng.uniform(0.7, 1.3))], dur, "exp")
    return d.bandpass(d.noise(dur, rng), sweep, 1.8) * env * level


def _petal_cloud(rng: Rng, count: int, spread_sec: float, level: float = 0.5) -> np.ndarray:
    parts = [(rng.uniform(0.0, spread_sec), _petal(rng, level * rng.uniform(0.6, 1.0))) for _ in range(count)]
    return d.place((0.0, d.silence(spread_sec)), *parts)


def _thorn(rng: Rng, level: float = 1.0) -> np.ndarray:
    """A thorn snapping out or stabbing in: bright, dry, a few ms long."""
    dur = 0.05
    tip = d.highpass(d.noise(dur, rng), rng.uniform(3500.0, 5000.0)) * d.decay(dur, 0.004, 0.0005)
    snap = d.bandpass(d.noise(dur, rng), rng.uniform(1800.0, 2600.0), 4.0) * d.decay(dur, 0.01)
    return (tip * 1.4 + snap) * level


def _sprout(rng: Rng, low_hz: float, high_hz: float, dur: float = 0.09) -> np.ndarray:
    """A bud pushing out: a quick rising organic bloop."""
    pitch = d.curve([(0, low_hz), (dur * 0.7, high_hz), (dur, high_hz * 1.05)], dur, "exp")
    tone = d.osc(pitch, dur, "triangle") * d.adsr(dur, 0.008, 0.02, 0.5, dur * 0.5)
    return d.lowpass(tone, 2400.0)


def _swish(rng: Rng, dur: float, low_hz: float, high_hz: float, peak_at: float) -> np.ndarray:
    """Air torn by a whipping vine ("vút"): band noise sweeping up to the
    tip speed, then dropping as it passes."""
    center = d.curve([(0, low_hz), (peak_at, high_hz), (dur, low_hz * 1.8)], dur, "exp")
    env = d.curve([(0, 0.0), (peak_at * 0.6, 0.25), (peak_at, 1.0), (dur, 0.0)], dur) ** 1.5
    return d.bandpass(d.noise(dur, rng), center, 2.2) * env


def _rose_bell(freq: float, dur: float, decay_sec: float, brightness: float = 1.6) -> np.ndarray:
    """Magic tone of the rose: the shared bell with a slow chorus beat so it
    shimmers instead of ringing like metal."""
    beat = d.bell(freq, dur, decay_sec, brightness) + d.bell(freq * 1.004, dur, decay_sec, brightness) * 0.6
    return beat / 1.6


def _crimson_pad(dur: float, pitch_hz: d.Curve, cutoff_hz: d.Curve) -> np.ndarray:
    """Red energy: detuned saws through an opening lowpass (warm, not evil)."""
    n = d.samples(dur)
    base = d._match(pitch_hz, n)
    voices = sum(d.osc(base * detune, dur, "saw") for detune in (0.993, 1.0, 1.007, 2.0))
    return d.lowpass(voices / 4.0, cutoff_hz, 1.2)


def _fit(x: np.ndarray, max_sec: float, fade_sec: float) -> np.ndarray:
    """Holds a sound to its time budget, letting the reverb tail fade out
    inside it instead of being chopped."""
    return d.fade(x[: d.samples(max_sec)], 0.0, fade_sec)


def _magic_pop(rng: Rng, high_hz: float, low_hz: float, dur: float = 0.22) -> np.ndarray:
    """Soft "bụp" of released energy: a round pitch drop with no
    broadband crack, so it never reads as a gunshot."""
    pitch = d.curve([(0, high_hz), (0.06, low_hz), (dur, low_hz * 0.9)], dur, "exp")
    round_tone = d.osc(pitch, dur) * d.decay(dur, 0.06, 0.004)
    puff = d.lowpass(d.noise(dur, rng, "pink"), d.curve([(0, 2600), (dur, 500)], dur, "exp")) * d.decay(dur, 0.04, 0.004)
    return round_tone + puff * 0.6


# --- One-shots -------------------------------------------------------------------

@sound("rose_thorn_cast", "skill", "Hoa Hồng Gai: dây gai căng, quất, phóng cầu hoa hồng", variants=2)
def rose_thorn_cast(rng: Rng) -> np.ndarray:
    dur = 0.72
    tension_dur = 0.24
    creak = _creak(rng, tension_dur, d.curve([(0, 45), (tension_dur, 170)], tension_dur, "exp"),
                   d.curve([(0, 0.9), (tension_dur, 1.25)], tension_dur, "exp"))
    creak *= d.curve([(0, 0.2), (tension_dur * 0.85, 1.0), (tension_dur, 0.3)], tension_dur) * 0.9
    swish = _swish(rng, 0.24, 500.0, 5200.0, 0.12) * 1.1
    crack = _thorn(rng, 0.9)
    release_dur = dur - 0.28
    pop = _magic_pop(rng, 420.0, 150.0) * 0.8
    flare = d.bandpass(d.noise(release_dur, rng, "pink"), d.curve([(0, 900), (0.12, 3200), (release_dur, 1800)], release_dur, "exp"), 1.4)
    flare *= d.adsr(release_dur, 0.03, 0.08, 0.35, release_dur * 0.6) * 0.45
    chord = sum(_rose_bell(freq, release_dur, 0.22, 1.8) * gain for freq, gain in ((NOTE_D6, 0.3), (NOTE_A5, 0.26), (NOTE_F6, 0.18)))
    mix = d.place(
        (0.0, creak),
        (0.16, swish),
        (0.28, crack),
        (0.28, pop),
        (0.29, flare + chord),
        (0.30, _petal_cloud(rng, 6, 0.2, 0.45)),
    )
    return _fit(d.reverb(d.drive(mix, 1.3), 0.14, 0.35, 0.35), 0.76, 0.2)


@sound("rose_thorn_hurt", "impact", "Hoa Hồng Gai bị trúng đòn: thân gỗ rung, rơi gai và cánh hoa", variants=2)
def rose_thorn_hurt(rng: Rng) -> np.ndarray:
    dur = 0.42
    knock_dur = 0.18
    knock = d.bandpass(d.noise(knock_dur, rng), 520.0 * rng.uniform(0.93, 1.07), 5.0) * d.decay(knock_dur, 0.03) * 2.2
    body = d.osc(d.curve([(0, 300), (knock_dur, 210)], knock_dur, "exp"), knock_dur) * d.decay(knock_dur, 0.035) * 0.6
    crack = d.highpass(d.impulses(0.06, 260, rng), 1800.0) * d.decay(0.06, 0.02) * 2.5
    shake_dur = 0.3
    tremble = 0.55 + 0.45 * np.sin(d.phase(d.curve([(0, 17), (shake_dur, 9)], shake_dur), shake_dur))
    rustle = d.bandpass(d.impulses(shake_dur, 700, rng) + d.noise(shake_dur, rng) * 0.25, 2600.0, 0.9)
    rustle *= d.decay(shake_dur, 0.09) * tremble * 1.2
    wobble = 1.0 + 0.05 * np.sin(d.phase(23.0, dur))
    flicker = (d.lowpass(rng.standard_normal(d.samples(dur)), 30.0) > -0.2).astype(float)
    falter = d.fm(d.curve([(0, NOTE_A5), (dur, NOTE_F5)], dur, "exp") * wobble, 2.0, 0.8, dur)
    falter = d.lowpass(falter * d.lowpass(flicker, 60.0), 2500.0) * d.decay(dur, 0.12, 0.02) * 0.22
    mix = d.place(
        (0.0, knock + body),
        (0.015, crack),
        (0.02, rustle),
        (0.03, _thorn(rng, 0.35)),
        (0.06, _thorn(rng, 0.25)),
        (0.03, _petal_cloud(rng, 4, 0.16, 0.4)),
        (0.0, falter),
    )
    return _fit(d.reverb(mix, 0.1, 0.2, 0.2), 0.46, 0.08)


@sound("rose_thorn_upgrade", "skill", "Hoa Hồng Gai lên cấp: chồi mọc, hoa nở, ma thuật đỏ dâng lên")
def rose_thorn_upgrade(rng: Rng) -> np.ndarray:
    grow_dur = 0.65
    creak = _creak(rng, grow_dur, d.curve([(0, 30), (grow_dur, 120)], grow_dur, "exp"),
                   d.curve([(0, 0.85), (grow_dur, 1.2)], grow_dur, "exp"))
    creak *= d.curve([(0, 0.0), (0.2, 0.6), (grow_dur * 0.9, 0.8), (grow_dur, 0.0)], grow_dur) * 0.55
    sprout_times = 0.05 + 0.5 * (np.linspace(0.0, 1.0, 7) ** 0.7)
    sprouts = [(t, _sprout(rng, 260.0 + 60 * i, 700.0 + 110 * i) * 0.35) for i, t in enumerate(sprout_times)]
    vine_dur = 0.9
    vines = d.bandpass(d.impulses(vine_dur, 500, rng) + d.noise(vine_dur, rng) * 0.2, d.curve([(0, 1500), (vine_dur, 3200)], vine_dur, "exp"), 1.0)
    vines *= d.adsr(vine_dur, 0.4, 0.2, 0.6, 0.3) * 0.5
    bloom = _petal_cloud(rng, 22, 0.6, 0.5)
    rise_dur = 1.25
    energy = _crimson_pad(rise_dur, d.curve([(0, NOTE_D3), (rise_dur, NOTE_D4)], rise_dur, "exp"),
                          d.curve([(0, 300), (rise_dur, 4200)], rise_dur, "exp"))
    energy *= d.curve([(0, 0.0), (rise_dur * 0.92, 1.0), (rise_dur, 0.0)], rise_dur) ** 1.6 * 0.5
    riser = d.bandpass(d.noise(rise_dur, rng), d.curve([(0, 600), (rise_dur, 6000)], rise_dur, "exp"), 2.0)
    riser *= d.curve([(0, 0.0), (rise_dur * 0.95, 1.0), (rise_dur, 0.0)], rise_dur) ** 2 * 0.35
    notes = (NOTE_D5, NOTE_F5, NOTE_A5, NOTE_D6, NOTE_E6, NOTE_A6)
    climb = [(0.55 + index * 0.1, _rose_bell(freq, 0.5, 0.16, 1.4) * 0.22) for index, freq in enumerate(notes)]
    burst_dur = 0.75
    burst_chord = sum(_rose_bell(freq, burst_dur, 0.45, 2.2) * gain for freq, gain in
                      ((NOTE_D5, 0.32), (NOTE_A5, 0.3), (NOTE_D6, 0.3), (NOTE_F6, 0.2), (NOTE_A6, 0.2)))
    glitter = d.highpass(d.impulses(burst_dur, 160, rng), 6500.0) * d.decay(burst_dur, 0.25) * 2.4
    thump = _magic_pop(rng, 260.0, 70.0, 0.35) * 0.8
    mix = d.place(
        (0.0, creak),
        *sprouts,
        (0.1, vines),
        (0.45, bloom),
        (0.0, energy),
        (0.0, riser),
        *climb,
        (1.22, burst_chord + glitter),
        (1.22, thump),
    )
    return _fit(d.reverb(mix, 0.28, 0.65, 0.7), 1.92, 0.4)


def _vortex(rng: Rng, dur: float) -> np.ndarray:
    """Crimson energy spiralling up: band noise whose centre circles faster
    and higher, with a matching amplitude swirl."""
    spin_hz = d.curve([(0, 1.5), (dur, 11.0)], dur, "exp")
    spin = np.sin(d.phase(spin_hz, dur))
    centre = d.curve([(0, 500), (dur, 3600)], dur, "exp") * (1.0 + 0.35 * spin)
    swirl = d.bandpass(d.noise(dur, rng), centre, 3.0) * (0.65 + 0.35 * spin)
    swell = d.curve([(0, 0.0), (dur * 0.9, 1.0), (dur, 0.2)], dur) ** 1.8
    return swirl * swell


def _blooming_layers(rng: Rng, layers: int, gap_sec: float) -> np.ndarray:
    """Each petal ring unfurls as a soft rotating whoosh, one ring after
    another, the outer rings lower and wider."""
    parts = []
    for ring in range(layers):
        dur = 0.55
        spin = np.sin(d.phase(d.curve([(0, 9.0 - ring), (dur, 4.0)], dur), dur))
        centre = d.curve([(0, 3800 - ring * 450), (dur, 1500 - ring * 150)], dur, "exp") * (1.0 + 0.2 * spin)
        unfurl = d.bandpass(d.noise(dur, rng, "pink"), centre, 1.6) * d.adsr(dur, 0.12, 0.1, 0.5, 0.3)
        parts.append((ring * gap_sec, unfurl * (0.5 + 0.08 * ring)))
        parts.append((ring * gap_sec + 0.05, _petal_cloud(rng, 5, 0.35, 0.35)))
    return d.place(*parts)


@sound("rose_thorn_evolve", "skill", "Hoa Hồng Gai tiến hoá: rễ mọc, hồng khổng lồ nở, xoáy ma thuật đỏ bùng nổ")
def rose_thorn_evolve(rng: Rng) -> np.ndarray:
    root_dur = 1.4
    rumble = d.lowpass(d.noise(root_dur, rng, "brown"), d.curve([(0, 90), (root_dur, 260)], root_dur, "exp"))
    rumble *= d.adsr(root_dur, 0.4, 0.3, 0.7, 0.5) * 0.7
    roots = _creak(rng, root_dur, d.curve([(0, 18), (root_dur, 70)], root_dur, "exp"), 0.62)
    roots *= d.adsr(root_dur, 0.25, 0.2, 0.75, 0.4) * 0.7
    trunk = _creak(rng, 1.1, d.curve([(0, 35), (1.1, 140)], 1.1, "exp"), d.curve([(0, 0.85), (1.1, 1.3)], 1.1, "exp"))
    trunk *= d.adsr(1.1, 0.5, 0.2, 0.6, 0.3) * 0.45
    thorn_times = 0.15 + 1.25 * (np.linspace(0.0, 1.0, 14) ** 0.75) + rng.uniform(-0.03, 0.03, 14)
    thorns = [(t, d.lowpass(_thorn(rng, 0.14 + 0.012 * i), 7000.0)) for i, t in enumerate(thorn_times)]
    sprouts = [(t + 0.01, _sprout(rng, 200.0 + 25 * i, 520.0 + 50 * i, 0.07) * 0.18) for i, t in enumerate(thorn_times[::2])]
    bloom = _blooming_layers(rng, 4, 0.18)
    rise_dur = 1.85
    pad = _crimson_pad(rise_dur, d.curve([(0, NOTE_D3 / 2), (rise_dur, NOTE_D4)], rise_dur, "exp"),
                       d.curve([(0, 200), (rise_dur, 5000)], rise_dur, "exp"))
    pad *= d.curve([(0, 0.0), (rise_dur * 0.93, 1.0), (rise_dur, 0.0)], rise_dur) ** 1.7 * 0.55
    vortex = _vortex(rng, rise_dur) * 0.6
    notes = (NOTE_D4, NOTE_A4, NOTE_D5, NOTE_F5, NOTE_A5, NOTE_D6, NOTE_E6, NOTE_A6)
    climb = [(1.05 + index * 0.13, _rose_bell(freq, 0.6, 0.2, 1.4) * 0.18) for index, freq in enumerate(notes)]
    final_dur = 1.6
    sub = d.osc(d.curve([(0, 95), (0.5, 38)], final_dur, "exp"), final_dur) * d.decay(final_dur, 0.35, 0.004) * 1.2
    blast = d.lowpass(d.noise(final_dur, rng, "brown"), d.curve([(0, 3000), (0.6, 150)], final_dur, "exp"))
    blast *= d.decay(final_dur, 0.3, 0.004) * 0.9
    chord = sum(_rose_bell(freq, final_dur, decay_sec, 2.0) * gain for freq, decay_sec, gain in
                ((NOTE_D4, 1.3, 0.35), (NOTE_A4, 1.2, 0.3), (NOTE_D5, 1.1, 0.3), (NOTE_F5, 1.0, 0.24),
                 (NOTE_A5, 0.9, 0.22), (NOTE_E6, 0.8, 0.16)))
    warm = _crimson_pad(final_dur, NOTE_D4, d.curve([(0, 4000), (final_dur, 600)], final_dur, "exp"))
    warm *= d.decay(final_dur, 0.6, 0.01) * 0.3
    glitter = d.highpass(d.impulses(final_dur, 120, rng), 6500.0) * d.decay(final_dur, 0.45) * 2.2
    burst_at = 2.15
    mix = d.place(
        (0.0, rumble),
        (0.0, roots),
        (0.3, trunk),
        *thorns,
        *sprouts,
        (0.95, bloom),
        (0.3, pad),
        (0.3, vortex),
        *climb,
        (burst_at, sub + blast),
        (burst_at, chord + warm),
        (burst_at + 0.02, glitter),
        (burst_at, _petal_cloud(rng, 18, 0.5, 0.45)),
    )
    build_up = d.curve([(0, 0.55), (burst_at, 1.0), (burst_at + 0.01, 1.0)], len(mix) / d.SAMPLE_RATE)
    return _fit(d.reverb(d.drive(mix * build_up, 1.2), 0.32, 0.85, 1.1), 3.8, 0.9)


@sound("rose_thorn_hit", "impact", "Đòn Hoa Hồng Gai trúng zombie: thụp, gai đâm, cánh hoa nổ tung", variants=3)
def rose_thorn_hit(rng: Rng) -> np.ndarray:
    thud_dur = 0.25
    thud = d.osc(d.curve([(0, 170 * rng.uniform(0.95, 1.05)), (0.08, 62)], thud_dur, "exp"), thud_dur)
    thud = thud * d.decay(thud_dur, 0.06, 0.002)
    body = d.lowpass(d.noise(thud_dur, rng, "pink"), d.curve([(0, 1800), (thud_dur, 300)], thud_dur, "exp"))
    body *= d.decay(thud_dur, 0.035, 0.002) * 0.9
    squeeze_dur = 0.12
    squeeze = _creak(rng, squeeze_dur, d.curve([(0, 150), (squeeze_dur, 60)], squeeze_dur, "exp"), 1.15)
    squeeze *= d.curve([(0, 0.0), (0.03, 1.0), (squeeze_dur, 0.0)], squeeze_dur) * 0.45
    stabs = [(0.012 + i * rng.uniform(0.022, 0.032), _thorn(rng, 0.8 - 0.15 * i)) for i in range(3)]
    mix = d.place(
        (0.0, d.drive(thud + body, 1.8)),
        *stabs,
        (0.05, squeeze),
        (0.02, _magic_pop(rng, 520.0, 190.0, 0.2) * 0.55),
        (0.025, _petal_cloud(rng, 9, 0.18, 0.55)),
        (0.03, _rose_bell(NOTE_D6 * rng.uniform(0.98, 1.02), 0.3, 0.07, 1.2) * 0.12),
    )
    return _fit(d.reverb(mix, 0.1, 0.25, 0.25), 0.52, 0.1)


# --- Seamless loops ------------------------------------------------------------------------

LOOP_LEVEL_DB = -27.0
LOOP_SETTLE_PERIODS = 3
# Swept filters update once per FILTER_BLOCK samples; a period made of
# whole blocks makes every period filter identically, so the seam is exact.
FLY_PERIOD_SEC = 516 * d.FILTER_BLOCK / d.SAMPLE_RATE


@dataclass(frozen=True)
class LoopSpec:
    name: str
    label: str
    period_sec: float
    recipe: Callable[[Rng, float], np.ndarray]
    variants: int = 1


LOOPS: list[LoopSpec] = []


def loop_sound(name: str, label: str, period_sec: float) -> Callable:
    """Registers a looping recipe. The recipe renders several periods of a
    signal whose every modulation repeats once per period_sec; the last
    period is kept, after filters and reverb have settled into that cycle."""
    def register(recipe: Callable[[Rng, float], np.ndarray]) -> Callable:
        LOOPS.append(LoopSpec(name, label, period_sec, recipe))
        return recipe
    return register


def _periodic_noise(rng: Rng, period_sec: float, total_sec: float, color: str = "white") -> np.ndarray:
    """The same noise grain repeated every period, so after filtering the
    output also repeats exactly."""
    grain = d.noise(period_sec, rng, color)
    repeats = int(np.ceil(total_sec / period_sec))
    return np.tile(grain, repeats)[: d.samples(total_sec)]


def _cycles(cycles_per_period: float, period_sec: float, total_sec: float) -> np.ndarray:
    """Phase of a modulation that completes a whole number of cycles per period."""
    return d.phase(cycles_per_period / period_sec, total_sec)


@loop_sound("rose_thorn_fly", "Cầu hoa hồng đang bay: xoáy gió, dây gai sột soạt, ngân ma thuật (loop)",
            FLY_PERIOD_SEC)
def rose_thorn_fly(rng: Rng, period_sec: float) -> np.ndarray:
    total = period_sec * (LOOP_SETTLE_PERIODS + 1)
    spin = np.sin(_cycles(4, period_sec, total))
    drift = np.sin(_cycles(1, period_sec, total) + 0.7)
    air = _periodic_noise(rng, period_sec, total)
    whoosh_centre = 900.0 * (1.0 + 0.28 * spin + 0.12 * drift)
    whoosh = d.bandpass(air, whoosh_centre, 1.6) * (0.75 + 0.25 * spin)
    body = d.lowpass(_periodic_noise(rng, period_sec, total, "pink"), 420.0) * (0.8 + 0.2 * spin) * 0.6
    rustle_grain = d.impulses(period_sec, 140, rng)
    rustle = d.bandpass(np.tile(rustle_grain, LOOP_SETTLE_PERIODS + 1)[: len(air)], 3000.0, 1.2)
    rustle *= (0.5 + 0.5 * np.sin(_cycles(4, period_sec, total) + 1.9)) ** 2 * 0.9
    flutter = 0.5 + 0.5 * np.sin(_cycles(27, period_sec, total))
    petals = d.bandpass(_periodic_noise(rng, period_sec, total), 4800.0, 2.5) * flutter * (0.6 + 0.4 * drift) * 0.35
    hum_partials = ((NOTE_D5, 0.5), (NOTE_A5, 0.35), (NOTE_D6, 0.18))
    vibrato_phase = _cycles(6, period_sec, total)
    hum = np.zeros(len(air))
    for freq, gain in hum_partials:
        locked = round(freq * period_sec) / period_sec
        wobble = 0.004 * np.cos(vibrato_phase) * locked
        hum += np.sin(d.phase(locked + wobble, total)) * gain
    hum *= (0.7 + 0.3 * np.sin(_cycles(2, period_sec, total) + 0.3)) * 0.18
    mix = whoosh + body + rustle + petals + hum
    return d.reverb(mix, 0.15, 0.3, 0.0)[: len(air)]


def master_loop(raw: np.ndarray, period_sec: float, target_rms_db: float = LOOP_LEVEL_DB) -> np.ndarray:
    """Keeps the final, settled period and levels it with a plain gain. No
    trim, fade or limiter: anything that touches the ends breaks the seam."""
    settled = d.highpass(raw, 30.0)
    period = settled[-d.samples(period_sec):]
    gain = 10 ** ((target_rms_db - d.active_rms_db(period)) / 20.0)
    period = period * gain
    peak = np.max(np.abs(period))
    if peak > 0.89:
        period *= 0.89 / peak
    return period


def write_loop_wav(path: Path, take: np.ndarray) -> None:
    """16-bit mono WAV with a RIFF "smpl" chunk looping the whole file, so
    Godot's importer (Loop Mode: Detect From WAV, the default) loops it."""
    pcm = np.clip(np.round(take * 32767.0), -32768, 32767).astype("<i2").tobytes()
    fmt = struct.pack("<HHIIHH", 1, 1, d.SAMPLE_RATE, d.SAMPLE_RATE * 2, 2, 16)
    # Header: manufacturer, product, sample period (ns), MIDI unity note,
    # pitch fraction, SMPTE format, SMPTE offset, loop count, sampler data.
    smpl = struct.pack("<9I", 0, 0, int(1e9 / d.SAMPLE_RATE), 60, 0, 0, 0, 1, 0)
    # One forward loop: cue id, type 0 = forward, start, inclusive end, fraction, play count 0 = forever.
    smpl += struct.pack("<6I", 0, 0, 0, len(take) - 1, 0, 0)
    chunks = [(b"fmt ", fmt), (b"data", pcm), (b"smpl", smpl)]
    body = b"WAVE" + b"".join(tag + struct.pack("<I", len(data)) + data for tag, data in chunks)
    path.write_bytes(b"RIFF" + struct.pack("<I", len(body)) + body)

"""Render the Final Move game sounds to WAV. Run from anywhere: python brand/build_sounds.py

Every sound is synthesized here from scratch, so the set is original and needs no licence.
Output is deterministic. Pieces are wood on wood; everything musical is a marimba, which
suits the sticker-book look better than synth beeps.

WAV rather than MP3 because MP3 adds silence at the start of a file, and a click that lands
late feels broken. These are short mono files, so the whole set stays small.
"""
import math
import pathlib
import random
import struct
import wave

RATE = 32_000
OUT = pathlib.Path(__file__).parent.parent / "apps" / "web" / "public" / "audio" / "game"

C5, D5, E5, F5, G5, A5 = 523.25, 587.33, 659.25, 698.46, 783.99, 880.0
A4, F4, D4, G4 = 440.0, 349.23, 293.66, 392.0
C6, E6, G6 = 1046.5, 1318.51, 1567.98


def blank(seconds):
    return [0.0] * int(seconds * RATE)


def add(buf, sound, at=0.0, gain=1.0):
    """Mix a sound into the buffer, growing it if needed."""
    start = int(at * RATE)
    if start + len(sound) > len(buf):
        buf.extend([0.0] * (start + len(sound) - len(buf)))
    for i, s in enumerate(sound):
        buf[start + i] += s * gain
    return buf


def partials(modes, seconds):
    """Decaying sine partials: (frequency, level, decay in seconds)."""
    out = blank(seconds)
    for freq, level, decay in modes:
        w = 2 * math.pi * freq / RATE
        for i in range(len(out)):
            out[i] += level * math.exp(-(i / RATE) / decay) * math.sin(w * i)
    return out


def click(seconds, cutoff, seed, level=1.0):
    """A tiny burst of low-passed noise: the moment of contact."""
    rng = random.Random(seed)
    alpha = 1 - math.exp(-2 * math.pi * cutoff / RATE)
    low = 0.0
    out = []
    for i in range(int(seconds * RATE)):
        low += alpha * (rng.uniform(-1, 1) - low)
        out.append(low * level * math.exp(-(i / RATE) / (seconds / 4)))
    return out


def room(buf):
    """A few quiet early reflections, so a hit sits in a room rather than in a vacuum."""
    out = list(buf) + [0.0] * int(0.05 * RATE)
    for ms, gain in ((9, 0.16), (15, 0.11), (23, 0.07), (34, 0.04)):
        add(out, buf, ms / 1000, gain)
    return out


def finish(buf, peak_db):
    """Soft-limit, normalize to a target peak, and fade the tail so nothing clicks at the end."""
    buf = [math.tanh(1.15 * s) for s in buf]
    top = max(abs(s) for s in buf) or 1.0
    target = 10 ** (peak_db / 20)
    fade = min(int(0.02 * RATE), len(buf))
    out = [s / top * target for s in buf]
    for i in range(fade):
        out[len(out) - 1 - i] *= i / fade
    return out


def piece(seed, weight=1.0):
    """A felted chess piece landing on a wooden board. Heavier means lower and longer."""
    rng = random.Random(seed)
    jitter = lambda v: v * rng.uniform(0.97, 1.03)
    body = partials([
        (jitter(190) / weight, 0.85, 0.030 * weight),
        (jitter(410) / weight, 0.55, 0.020 * weight),
        (jitter(860), 0.42, 0.013),
        (jitter(1480), 0.20, 0.008),
        (jitter(2650), 0.08, 0.005),
    ], 0.16 * weight)
    return add(body, click(0.006, 3800, seed + 1), 0, 0.55)


def marimba(freq, seconds=0.7, level=1.0, seed=0):
    """A soft mallet on a tuned bar: a warm fundamental with the bar's high overtones."""
    bar = partials([
        (freq, 1.0, 0.26),
        (freq * 3.93, 0.20, 0.06),
        (freq * 9.2, 0.05, 0.02),
    ], seconds)
    add(bar, click(0.004, 2600, seed + 11), 0, 0.14)
    return [s * level for s in bar]


def bell(freq, seconds=1.2, level=1.0):
    return [s * level for s in partials([
        (freq, 0.8, 0.45), (freq * 2.0, 0.35, 0.30), (freq * 2.76, 0.18, 0.18), (freq * 5.4, 0.06, 0.08),
    ], seconds)]


def phrase(notes, step, tail=0.8):
    out = blank(step * len(notes) + tail)
    for i, freq in enumerate(notes):
        add(out, marimba(freq, tail, seed=i), i * step, 0.75 + 0.25 * i / max(1, len(notes) - 1))
    return out


def move():
    return finish(room(piece(1)), -8)


def capture():
    # The taken piece gets knocked, then the capturing piece lands on the same square.
    out = blank(0.26)
    add(out, piece(5, 1.0), 0, 0.5)
    add(out, piece(7, 1.25), 0.038, 1.0)
    return finish(room(out), -5)


def castle():
    # King, then rook: two ordinary moves in quick succession.
    out = blank(0.34)
    add(out, piece(11, 1.1), 0, 1.0)
    add(out, piece(13, 0.95), 0.125, 0.85)
    return finish(room(out), -7)


def check():
    # A dry wooden warning on top of the move sound. It must cut through without alarming.
    out = blank(0.34)
    add(out, marimba(A5, 0.3, seed=21), 0, 0.7)
    add(out, marimba(E6, 0.26, seed=22), 0.075, 0.55)
    return finish(room(out), -12)


def promote():
    return finish(room(phrase([G5, C6, E6, G6], 0.062, 0.55)), -9)


def illegal():
    # Soft and low: a nudge rather than a scolding.
    out = partials([(150, 0.9, 0.035), (230, 0.5, 0.022)], 0.13)
    return finish(room(out), -14)


def start():
    return finish(room(phrase([C5, E5, G5], 0.095, 0.6)), -10)


def win():
    out = phrase([C5, E5, G5, C6, E6], 0.105, 1.0)
    add(out, bell(C6, 1.3, 0.22), 0.42)
    add(out, bell(G6, 1.1, 0.10), 0.47)
    return finish(room(out), -7)


def lose():
    # Gentle and a little rueful. Losing is character building, not a funeral.
    return finish(room(phrase([A4, F4, D4], 0.17, 0.8)), -11)


def draw():
    # A question that never quite resolves, which is what a draw is.
    return finish(room(phrase([G4, C5, D5], 0.135, 0.75)), -11)


def low_time():
    out = blank(0.34)
    add(out, marimba(A5, 0.26, seed=31), 0, 1.0)
    add(out, marimba(A5, 0.26, seed=32), 0.13, 0.8)
    return finish(room(out), -11)


def notify():
    return finish(room(phrase([E5, A5], 0.11, 0.5)), -12)


SOUNDS = {
    "move": move, "capture": capture, "castle": castle, "check": check, "promote": promote,
    "illegal": illegal, "start": start, "win": win, "lose": lose, "draw": draw,
    "low-time": low_time, "notify": notify,
}


def write(name, samples):
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1.0, min(1.0, s)) * 32767)) for s in samples))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, make in SOUNDS.items():
        write(name, make())
        size = (OUT / f"{name}.wav").stat().st_size
        total += size
        print(f"{name:10s} {size / 1024:6.1f} KB")
    print(f"{'total':10s} {total / 1024:6.1f} KB")

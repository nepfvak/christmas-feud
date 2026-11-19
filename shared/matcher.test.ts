import { describe, expect, it } from "vitest";
import { matchAnswer, normalize } from "./matcher";
import data from "../data/questions.json";

const q = (id: string) => data.questions.find((x) => x.id === id)!;
const guess = (id: string, text: string) => {
  const question = q(id);
  const r = matchAnswer(text, question.answers);
  return r ? question.answers[r.index].label : null;
};

describe("normalize", () => {
  it("strips articles, punctuation, accents and plurals", () => {
    expect(normalize("The Grinch!")).toBe("grinch");
    expect(normalize("Michael Bublé")).toBe("michael buble");
    expect(normalize("12 Days of Xmas")).toBe("twelve day of christmas");
    expect(normalize("Cookies")).toBe(normalize("cookie"));
    expect(normalize("cherries")).toBe(normalize("cherry"));
  });
});

describe("matchAnswer on real survey data", () => {
  const cases: [string, string, string | null][] = [
    ["xmas-movie", "home alone", "Home Alone"],
    ["xmas-movie", "Home Alone 2", "Home Alone 2"],
    ["xmas-movie", "home alone two", "Home Alone 2"],
    ["xmas-movie", "elf", "Elf"],
    ["xmas-movie", "the grinch", "The Grinch"],
    ["xmas-movie", "how the grinch stole christmas", "The Grinch"],
    ["xmas-movie", "christmas vacation", "Christmas Vacation"],
    ["xmas-movie", "national lampoons", "Christmas Vacation"],
    ["xmas-movie", "polar express", "The Polar Express"],
    ["xmas-movie", "Its a wonderfull life", "It's a Wonderful Life"],
    ["xmas-movie", "die hard", "Die Hard"],
    ["xmas-movie", "christmas", null],
    ["xmas-movie", "banana", null],
    ["radio-song", "jingle bell rock", "Jingle Bell Rock"],
    ["radio-song", "all i want for christmas", "All I Want for Christmas Is You"],
    ["radio-song", "mariah carey", "All I Want for Christmas Is You"],
    ["carol", "12 days of christmas", "The Twelve Days of Christmas"],
    ["carol", "jingle bells", "Jingle Bells"],
    ["carol", "oh holy night", "O Holy Night"],
    ["character", "rudolf", "Rudolph"],
    ["character", "grinch", "The Grinch"],
    ["character", "scrooge", "Ebenezer Scrooge"],
    ["hot-drink", "egg nog", "Eggnog"],
    ["hot-drink", "hot cocoa", "Hot Chocolate"],
    ["holiday-plant", "pointsettia", "Poinsettia"],
    ["snow-activity", "snowman", "Build a Snowman"],
    ["snow-activity", "make a snow man", "Build a Snowman"],
    ["snow-activity", "snowball fight", "Snowball Fight"],
    ["winter-animal", "polar bears", "Polar Bear"],
    ["winter-animal", "penguins", "Penguin"],
    ["xmas-dinner", "mac n cheese", "Mac and Cheese"],
    ["new-years", "fireworks", "Fireworks"],
    ["santa", "presents", "Presents"],
    ["santa", "the north pole", "North Pole"],
    ["xmas-candy", "m and ms", "M&M's"],
    ["xmas-candy", "reeses", "Reese's"],
    ["winter-weather", "snowstorm", "Blizzard"],
    ["xmas-dinner", "mashed potatos", "Mashed Potatoes"],
  ];
  it.each(cases)("[%s] %s -> %s", (id, text, expected) => {
    expect(guess(id, text)).toBe(expected);
  });
});

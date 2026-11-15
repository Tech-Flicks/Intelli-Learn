/**
 * Harmless twins of blocked words that STEM lessons need. Each of these used to reject a
 * correct challenge (and cost its one feedback round). The dangerous meaning stays blocked.
 */
import { describe, expect, it } from 'vitest';
import { localSafetyCheck } from './safety';

const safe = (text: string, strictness: 'strict' | 'standard' = 'strict'): boolean => localSafetyCheck(text, strictness).safe;

describe('localSafetyCheck: science and engineering vocabulary', () => {
  it('allows germs, weeds and plants as what gets killed, in both settings', () => {
    for (const text of [
      'Washing your hands with soap kills germs.',
      'Soap kills many germs.',
      'Antibiotics kill bacteria but not viruses.',
      'Heat kills most of the harmful bacteria in milk.',
      'A frost can kill young plants.',
      'Boiling water killed the weeds.',
    ]) {
      expect(safe(text), text).toBe(true);
      expect(safe(text, 'standard'), text).toBe(true);
    }
  });

  it('still blocks killing anyone or anything else', () => {
    for (const text of ['The knight kills the dragon.', 'Kill the germs and kill the dragon.', 'I will kill you.', 'The cat killed a bird.', 'kill them all']) {
      expect(safe(text, 'standard'), text).toBe(false);
    }
  });

  it('allows tools and instruments that have "gun" or "strippers" in their name', () => {
    for (const text of ['Stick the wheels on with a glue gun.', 'A radar gun measures speed.', 'Use a staple gun for the frame.', 'A heat gun shrinks the tube.', 'Wire strippers take off the plastic coat.']) {
      expect(safe(text), text).toBe(true);
    }
    for (const text of ['He has a gun.', 'a toy gun', 'machine gun', 'The strippers danced.', 'a glue gun and a real gun']) {
      expect(safe(text, 'standard'), text).toBe(false);
    }
  });

  it('allows the terms of geology, biology and the lab', () => {
    for (const text of [
      'Volcanic bombs are blobs of lava that cool in the air.',
      'Lava bombs can be as big as a car.',
      'Some plants make seeds by sexual reproduction, and others by asexual reproduction.',
      'A naked mole rat lives under the ground.',
      'Rubbing alcohol evaporates faster than water.',
      'An alcohol thermometer has a red line.',
      'The camel has drunk 40 litres of water.',
      'They have drunk all the juice.',
    ]) {
      expect(safe(text), text).toBe(true);
    }
    for (const text of ['They built bombs.', 'sexual content', 'the sex of a chick', 'a naked man', 'He drinks alcohol.', 'Dad is drunk.', 'She got drunk.', 'bread and beer']) {
      expect(safe(text, 'standard'), text).toBe(false);
    }
  });

  it('allows a secret code to crack, but no shared secret', () => {
    expect(safe('Help us crack our secret code!')).toBe(true);
    expect(safe('Can you read our secret message?')).toBe(true);
    for (const text of ['This is our secret.', 'It will be our little secret.', 'Keep our secret code from your mom: do not tell your parents.', 'our secret place']) {
      expect(safe(text, 'standard'), text).toBe(false);
    }
  });

  it('allows animal names in the gentle setting, and keeps the scary word blocked on its own', () => {
    for (const text of ['A vampire bat is a small mammal.', 'The poison dart frog is bright blue.', 'Creepy-crawlies live under the log.', 'Find the creepy crawly with six legs.']) {
      expect(safe(text), text).toBe(true);
    }
    for (const text of ['A vampire lives in the castle.', 'The berries are full of poison.', 'a creepy house', 'The frog was poisoned.']) {
      expect(safe(text), text).toBe(false);
    }
  });

  it('keeps the rules that protect a child exactly as they were', () => {
    for (const text of ['meet me at the pond', 'How old are you?', 'What is your address?', 'do not tell your parents', 'What is your location?', 'you losers']) {
      expect(safe(text, 'standard'), text).toBe(false);
    }
    for (const text of ['The plant died.', 'Dinosaurs died about 66 million years ago.', 'a deadly snake', 'Thunder can sound scary.']) {
      expect(safe(text), text).toBe(false);
    }
  });
});

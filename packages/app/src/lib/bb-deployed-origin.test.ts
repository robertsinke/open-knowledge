import { describe, expect, test } from 'vitest';
import {
  bbDeployedOriginSet,
  deployedOriginSetting,
  readBbDeployedOriginMessage,
} from './bb-deployed-origin';

describe('deployed origin setting', () => {
  test('keeps an http(s) origin and drops a path', () => {
    expect(deployedOriginSetting(' https://notes.example/kb ')).toBe('https://notes.example');
    expect(deployedOriginSetting('http://127.0.0.1:4173')).toBe('http://127.0.0.1:4173');
  });

  test('an empty value means the local server', () => {
    expect(deployedOriginSetting('')).toBeNull();
    expect(deployedOriginSetting('   ')).toBeNull();
  });

  test('rejects other schemes and embedded credentials', () => {
    expect(() => deployedOriginSetting('javascript:alert(1)')).toThrow(/http\(s\)/u);
    expect(() => deployedOriginSetting('JAVASCRIPT:alert(1)')).toThrow(/http\(s\)/u);
    expect(() => deployedOriginSetting('ftp://notes.example')).toThrow(/http\(s\)/u);
    expect(() => deployedOriginSetting('https://user:secret@notes.example')).toThrow(/http\(s\)/u);
    expect(() => deployedOriginSetting('https://user@notes.example')).toThrow(/http\(s\)/u);
    expect(() => deployedOriginSetting('not a url')).toThrow(/http\(s\)/u);
  });

  test('reads only a complete deployed-origin message', () => {
    expect(readBbDeployedOriginMessage(bbDeployedOriginSet('https://notes.example'))).toEqual(
      bbDeployedOriginSet('https://notes.example'),
    );
    expect(
      readBbDeployedOriginMessage({ type: 'open-knowledge:deployed-origin', intent: 'set' }),
    ).toBe(null);
    expect(readBbDeployedOriginMessage({ type: 'other', intent: 'set', origin: 'https://x' })).toBe(
      null,
    );
  });
});

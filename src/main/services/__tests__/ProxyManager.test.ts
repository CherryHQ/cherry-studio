import { describe, expect, it } from 'vitest'

import { matchIpRule, matchWildcardDomain } from '../ProxyManager'

describe('ProxyManager - matchWildcardDomain', () => {
  describe('Exact match', () => {
    it('should match exact domain', () => {
      expect(matchWildcardDomain('example.com', 'example.com')).toBe(true)
      expect(matchWildcardDomain('api.example.com', 'api.example.com')).toBe(true)
      expect(matchWildcardDomain('localhost', 'localhost')).toBe(true)
    })

    it('should not match different domains', () => {
      expect(matchWildcardDomain('example.com', 'different.com')).toBe(false)
      expect(matchWildcardDomain('api.example.com', 'example.com')).toBe(false)
    })
  })

  describe('Wildcard with *. prefix', () => {
    it('should match subdomains', () => {
      expect(matchWildcardDomain('api.example.com', '*.example.com')).toBe(true)
      expect(matchWildcardDomain('www.example.com', '*.example.com')).toBe(true)
      expect(matchWildcardDomain('sub.api.example.com', '*.example.com')).toBe(true)
    })

    it('should match the base domain itself', () => {
      expect(matchWildcardDomain('example.com', '*.example.com')).toBe(true)
    })

    it('should not match different domains', () => {
      expect(matchWildcardDomain('notexample.com', '*.example.com')).toBe(false)
      expect(matchWildcardDomain('examplexcom', '*.example.com')).toBe(false)
    })
  })

  describe('Wildcard with leading dot', () => {
    it('should treat leading dot as wildcard', () => {
      expect(matchWildcardDomain('api.example.com', '.example.com')).toBe(true)
      expect(matchWildcardDomain('www.example.com', '.example.com')).toBe(true)
      expect(matchWildcardDomain('example.com', '.example.com')).toBe(true)
    })
  })
})

describe('ProxyManager - matchIpRule', () => {
  describe('Exact IPv4 match', () => {
    it('should match exact IPv4 address', () => {
      expect(matchIpRule('192.168.1.100', '192.168.1.100')).toBe(true)
      expect(matchIpRule('127.0.0.1', '127.0.0.1')).toBe(true)
      expect(matchIpRule('10.0.0.1', '10.0.0.1')).toBe(true)
    })

    it('should not match different IPv4 addresses', () => {
      expect(matchIpRule('192.168.1.100', '192.168.1.101')).toBe(false)
      expect(matchIpRule('127.0.0.1', '127.0.0.2')).toBe(false)
    })
  })

  describe('Wildcard IPv4', () => {
    it('should match IPv4 with single wildcard', () => {
      expect(matchIpRule('192.168.1.1', '192.168.1.*')).toBe(true)
      expect(matchIpRule('192.168.1.100', '192.168.1.*')).toBe(true)
      expect(matchIpRule('192.168.1.255', '192.168.1.*')).toBe(true)
    })

    it('should match IPv4 with multiple wildcards', () => {
      expect(matchIpRule('192.168.1.1', '192.168.*.*')).toBe(true)
      expect(matchIpRule('192.168.100.200', '192.168.*.*')).toBe(true)
    })

    it('should not match different network', () => {
      expect(matchIpRule('192.169.1.1', '192.168.1.*')).toBe(false)
      expect(matchIpRule('10.0.1.1', '192.168.1.*')).toBe(false)
    })
  })

  describe('CIDR IPv4', () => {
    it('should match IPv4 in CIDR range /24', () => {
      expect(matchIpRule('192.168.1.1', '192.168.1.0/24')).toBe(true)
      expect(matchIpRule('192.168.1.100', '192.168.1.0/24')).toBe(true)
      expect(matchIpRule('192.168.1.255', '192.168.1.0/24')).toBe(true)
    })

    it('should match IPv4 in CIDR range /16', () => {
      expect(matchIpRule('192.168.0.1', '192.168.0.0/16')).toBe(true)
      expect(matchIpRule('192.168.1.1', '192.168.0.0/16')).toBe(true)
      expect(matchIpRule('192.168.255.255', '192.168.0.0/16')).toBe(true)
    })

    it('should not match IPv4 outside CIDR range', () => {
      expect(matchIpRule('192.169.1.1', '192.168.0.0/16')).toBe(false)
      expect(matchIpRule('10.0.0.1', '192.168.0.0/16')).toBe(false)
    })

    it('should handle /32 CIDR (single host)', () => {
      expect(matchIpRule('192.168.1.100', '192.168.1.100/32')).toBe(true)
      expect(matchIpRule('192.168.1.101', '192.168.1.100/32')).toBe(false)
    })
  })

  describe('IPv6', () => {
    it('should match exact IPv6 address', () => {
      expect(matchIpRule('::1', '::1')).toBe(true)
      expect(matchIpRule('[::1]', '[::1]')).toBe(true)
      expect(matchIpRule('2001:db8::1', '2001:db8::1')).toBe(true)
    })

    it('should match IPv6 in CIDR range', () => {
      expect(matchIpRule('2001:db8::1', '2001:db8::/32')).toBe(true)
      expect(matchIpRule('2001:db8:ffff:ffff:ffff:ffff:ffff:ffff', '2001:db8::/32')).toBe(true)
    })

    it('should not match IPv6 outside CIDR range', () => {
      expect(matchIpRule('2001:db9::1', '2001:db8::/32')).toBe(false)
    })

    it('should handle brackets in IPv6', () => {
      expect(matchIpRule('[::1]', '::1')).toBe(true)
      expect(matchIpRule('::1', '[::1]')).toBe(true)
    })
  })

  describe('Error handling', () => {
    it('should return false for invalid IP addresses', () => {
      expect(matchIpRule('invalid-ip', '192.168.1.0/24')).toBe(false)
      expect(matchIpRule('999.999.999.999', '192.168.1.0/24')).toBe(false)
    })

    it('should return false for malformed CIDR', () => {
      expect(matchIpRule('192.168.1.1', '192.168.1.0/999')).toBe(false)
      expect(matchIpRule('192.168.1.1', '192.168.1.0/abc')).toBe(false)
    })

    it('should return false when comparing IPv4 to IPv6 CIDR', () => {
      expect(matchIpRule('192.168.1.1', '2001:db8::/32')).toBe(false)
      expect(matchIpRule('2001:db8::1', '192.168.0.0/16')).toBe(false)
    })
  })
})

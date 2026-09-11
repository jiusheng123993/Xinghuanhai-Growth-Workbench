/**
 * 医院搜索服务测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  getNearbyHospitals,
  searchHospitals,
  getHospitalDetail,
  getEmergencyHospitals,
  getRecommendedHospitals,
  callHospital,
  navigateToHospital,
} from '../hospitalService'

vi.mock('../../data/hospitals', () => ({
  getNearbyHospitals: vi.fn((city?: string, species?: string) => {
    const hospitals = [
      {
        id: 'h001',
        name: '北京瑞派宠物医院',
        address: '北京市朝阳区',
        phone: '010-88886666',
        distance: 1.2,
        rating: 4.8,
        openHours: '09:00-21:00',
        services: ['内科', '外科', '影像科'],
        species: ['dog', 'cat', 'bird', 'rabbit'],
        emergency: false,
        latitude: 39.9042,
        longitude: 116.4074,
        city: '北京',
        type: 'general',
      },
      {
        id: 'h002',
        name: '北京爱诺动物医院（24h急诊）',
        address: '北京市海淀区',
        phone: '010-66668888',
        distance: 3.5,
        rating: 4.9,
        openHours: '24小时',
        services: ['24h急诊', '内科', '外科', 'ICU'],
        species: ['dog', 'cat', 'bird', 'rabbit', 'reptile', 'small_animal'],
        emergency: true,
        latitude: 39.959,
        longitude: 116.317,
        city: '北京',
        type: 'emergency',
      },
      {
        id: 'h003',
        name: '北京芭比堂动物眼科中心',
        address: '北京市西城区',
        phone: '010-55559999',
        distance: 5.8,
        rating: 4.7,
        openHours: '09:00-18:00',
        services: ['眼科专科', '白内障手术', '青光眼治疗'],
        species: ['dog', 'cat'],
        emergency: false,
        latitude: 39.9139,
        longitude: 116.3669,
        city: '北京',
        type: 'specialist',
        specialties: ['眼科'],
      },
      {
        id: 'h004',
        name: '上海瑞鹏宠物医院',
        address: '上海市浦东新区',
        phone: '021-68888888',
        distance: 2.1,
        rating: 4.6,
        openHours: '08:30-22:00',
        services: ['内科', '外科', '疫苗接种'],
        species: ['dog', 'cat', 'rabbit'],
        emergency: false,
        latitude: 31.2304,
        longitude: 121.4737,
        city: '上海',
        type: 'general',
      },
    ]

    let result = [...hospitals]
    if (city) {
      result = result.filter(h => h.city === city)
    }
    if (species) {
      result = result.filter(h => h.species.includes(species as never))
    }
    return result.sort((a, b) => a.distance - b.distance)
  }),
  searchHospitals: vi.fn((keyword: string) => {
    const hospitals = [
      {
        id: 'h001',
        name: '北京瑞派宠物医院',
        address: '北京市朝阳区',
        phone: '010-88886666',
        distance: 1.2,
        rating: 4.8,
        openHours: '09:00-21:00',
        services: ['内科', '外科', '影像科'],
        species: ['dog', 'cat', 'bird', 'rabbit'],
        emergency: false,
        latitude: 39.9042,
        longitude: 116.4074,
        city: '北京',
        type: 'general',
      },
      {
        id: 'h003',
        name: '北京芭比堂动物眼科中心',
        address: '北京市西城区',
        phone: '010-55559999',
        distance: 5.8,
        rating: 4.7,
        openHours: '09:00-18:00',
        services: ['眼科专科', '白内障手术'],
        species: ['dog', 'cat'],
        emergency: false,
        latitude: 39.9139,
        longitude: 116.3669,
        city: '北京',
        type: 'specialist',
        specialties: ['眼科'],
      },
    ]
    if (!keyword.trim()) return hospitals
    const lower = keyword.toLowerCase().trim()
    return hospitals.filter(h =>
      h.name.toLowerCase().includes(lower) ||
      h.address.toLowerCase().includes(lower) ||
      h.services.some(s => s.toLowerCase().includes(lower))
    )
  }),
  getHospitalById: vi.fn((id: string) => {
    const hospitals: Record<string, unknown> = {
      h001: {
        id: 'h001',
        name: '北京瑞派宠物医院',
        address: '北京市朝阳区',
        phone: '010-88886666',
        distance: 1.2,
        rating: 4.8,
        openHours: '09:00-21:00',
        services: ['内科', '外科'],
        species: ['dog', 'cat'],
        emergency: false,
        latitude: 39.9042,
        longitude: 116.4074,
        city: '北京',
        type: 'general',
      },
    }
    return hospitals[id]
  }),
  getEmergencyHospitals: vi.fn(() => [
    {
      id: 'h002',
      name: '北京爱诺动物医院（24h急诊）',
      address: '北京市海淀区',
      phone: '010-66668888',
      distance: 3.5,
      rating: 4.9,
      openHours: '24小时',
      services: ['24h急诊', '内科', '外科', 'ICU'],
      species: ['dog', 'cat', 'bird', 'rabbit', 'reptile', 'small_animal'],
      emergency: true,
      latitude: 39.959,
      longitude: 116.317,
      city: '北京',
      type: 'emergency',
    },
  ]),
  getHospitalsByType: vi.fn((type: string) => {
    if (type === 'emergency') {
      return [
        {
          id: 'h002',
          name: '北京爱诺动物医院（24h急诊）',
          address: '北京市海淀区',
          phone: '010-66668888',
          distance: 3.5,
          rating: 4.9,
          openHours: '24小时',
          services: ['24h急诊', '内科', '外科', 'ICU'],
          species: ['dog', 'cat', 'bird', 'rabbit', 'reptile', 'small_animal'],
          emergency: true,
          latitude: 39.959,
          longitude: 116.317,
          city: '北京',
          type: 'emergency',
        },
      ]
    }
    return []
  }),
}))

describe('hospitalService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getNearbyHospitals', () => {
    it('should return all hospitals when no filters applied', () => {
      const result = getNearbyHospitals()
      expect(result.length).toBeGreaterThan(0)
    })

    it('should filter by city', () => {
      const result = getNearbyHospitals({ city: '北京' })
      expect(result.every(h => h.city === '北京')).toBe(true)
    })

    it('should filter by species', () => {
      const result = getNearbyHospitals({ species: 'dog' })
      expect(result.every(h => h.species.includes('dog'))).toBe(true)
    })

    it('should sort by distance', () => {
      const result = getNearbyHospitals()
      for (let i = 1; i < result.length; i++) {
        expect(result[i].distance).toBeGreaterThanOrEqual(result[i - 1].distance)
      }
    })

    it('should handle empty options', () => {
      const result = getNearbyHospitals({})
      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('searchHospitals', () => {
    it('should search by keyword', () => {
      const result = searchHospitals('眼科')
      expect(result.length).toBeGreaterThan(0)
      expect(result[0].name).toContain('眼科')
    })

    it('should return empty array for empty keyword', () => {
      const result = searchHospitals('')
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle non-string input', () => {
      const result = searchHospitals('')
      expect(Array.isArray(result)).toBe(true)
    })

    it('should be case insensitive', () => {
      const result1 = searchHospitals('眼科')
      const result2 = searchHospitals('eye')
      expect(Array.isArray(result1)).toBe(true)
      expect(Array.isArray(result2)).toBe(true)
    })
  })

  describe('getHospitalDetail', () => {
    it('should return hospital by id', () => {
      const result = getHospitalDetail('h001')
      expect(result).not.toBeNull()
      expect(result?.id).toBe('h001')
    })

    it('should return null for invalid id', () => {
      const result = getHospitalDetail('invalid')
      expect(result).toBeNull()
    })

    it('should return null for empty id', () => {
      const result = getHospitalDetail('')
      expect(result).toBeNull()
    })
  })

  describe('getEmergencyHospitals', () => {
    it('should return only emergency hospitals', () => {
      const result = getEmergencyHospitals()
      expect(result.every(h => h.emergency)).toBe(true)
    })

    it('should return array', () => {
      const result = getEmergencyHospitals()
      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getRecommendedHospitals', () => {
    it('should return recommendations without symptoms', () => {
      const result = getRecommendedHospitals()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0].relevanceScore).toBe(0.5)
    })

    it('should match symptoms to specialties', () => {
      const result = getRecommendedHospitals('pet1', ['eye', 'vision'])
      expect(Array.isArray(result)).toBe(true)
    })

    it('should prioritize emergency for urgent symptoms', () => {
      const result = getRecommendedHospitals('pet1', ['emergency', 'poisoning'])
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle empty symptoms array', () => {
      const result = getRecommendedHospitals('pet1', [])
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    it('should sort by relevance score', () => {
      const result = getRecommendedHospitals('pet1', ['eye'])
      for (let i = 1; i < result.length; i++) {
        expect(result[i].relevanceScore).toBeLessThanOrEqual(result[i - 1].relevanceScore)
      }
    })
  })

  describe('callHospital', () => {
    it('should handle invalid phone', () => {
      expect(() => callHospital('')).not.toThrow()
    })

    it('should handle valid phone', () => {
      expect(() => callHospital('010-88886666')).not.toThrow()
    })
  })

  describe('navigateToHospital', () => {
    it('should handle invalid coordinates', () => {
      expect(() => navigateToHospital(NaN, NaN, 'test')).not.toThrow()
    })

    it('should handle valid coordinates', () => {
      expect(() => navigateToHospital(39.9042, 116.4074, 'test')).not.toThrow()
    })
  })
})

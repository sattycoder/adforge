// Ad Slot Model
// This file will contain the data model for ad slots

export class AdSlot {
  constructor(data) {
    this.id = data.id
    this.position = data.position
    this.size = data.size
    this.element = data.element
    this.deviceType = data.deviceType
    this.url = data.url
    this.createdAt = data.createdAt || new Date()
  }

  // Static methods for data operations
  static fromElement(element, deviceType, url) {
    return new AdSlot({
      id: Math.random().toString(36).substr(2, 9),
      position: element.getBoundingClientRect(),
      size: {
        width: element.offsetWidth,
        height: element.offsetHeight
      },
      element: element,
      deviceType,
      url
    })
  }
}

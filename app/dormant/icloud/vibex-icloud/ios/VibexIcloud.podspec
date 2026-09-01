Pod::Spec.new do |s|
  s.name           = 'VibexIcloud'
  s.version        = '1.0.0'
  s.summary        = 'iCloud Documents container access for VibeXStudio'
  s.description    = 'Exposes the app ubiquity container so projects sync between the user devices without any VibeX servers.'
  s.author         = 'VibeXStudio'
  s.homepage       = 'https://github.com/vibexstudio'
  s.license        = { type: 'Apache-2.0' }
  s.platforms      = { ios: '15.1' }
  s.source         = { git: '' }
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,swift}'
end

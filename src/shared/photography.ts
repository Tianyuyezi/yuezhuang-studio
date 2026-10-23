// Shared by templates, the description assistant and every final image request.
export const PHOTOGRAPHIC_DESCRIPTION = '以真实人像照片为标准：自然的表情与轻微不对称，保留符合年龄的细微毛孔、肤色变化、唇纹与零散发丝，衣料有真实织纹和褶皱。光源方向可信，肤色自然，妆品光泽限于实际涂抹部位。轻度修饰，避免磨皮蜡感、塑料高光、CG 人偶感与过度锐化。'

export const PHOTOGRAPHY_DIRECTION = 'Photorealistic portrait: a believable photograph taken with a real camera. The subject is a human, even when their identity is fictional. Keep age-appropriate subtle pores, small skin-tone variations, natural lip texture, individual hair strands and realistic fabric weave and folds. Use believable light direction, natural color balance, normal facial proportions, lifelike eyes and a relaxed expression with subtle natural asymmetry. Makeup is real pigment on skin: confine shimmer or metallic finish to the applied cosmetic, not the entire face. Preserve the requested makeup style, identity, age and clothing. Avoid heavy beauty retouching, waxy or airbrushed skin, plastic specular highlights, doll-like symmetry, CGI, illustration, excessive sharpening and cinematic poster polish. Do not simulate realism with exaggerated pores, added blemishes, dirt or artificial grain.'

export function photographicDescription(description: string) {
  // Polishing a previous result must not accumulate the application-owned suffix.
  const content = description.split(PHOTOGRAPHIC_DESCRIPTION).join('').trim()
  return `${content}\n\n${PHOTOGRAPHIC_DESCRIPTION}`
}

export function photographicImagePrompt(description: string, mode: 'virtual' | 'edit') {
  return `${description}\n\nRequired photographic treatment:\n${PHOTOGRAPHY_DIRECTION}\n${mode === 'edit'
    ? 'Apply this treatment only within the requested edit scope. Preserve the original person, scene, pose, clothing, hair and all details not requested to change. Do not invent a new setting or relight an unrelated area.'
    : 'Compose a naturally observed portrait with plausible camera perspective. Use a simple real environment and soft available light unless the subject request specifies another setting or light. A named fashion, bridal or creative makeup style still needs to look photographed on human skin.'}`
}

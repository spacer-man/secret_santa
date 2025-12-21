import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Media } from './media';

describe('Media', () => {
  let component: Media;
  let fixture: ComponentFixture<Media>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Media]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Media);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Wish } from './wish';

describe('Wish', () => {
  let component: Wish;
  let fixture: ComponentFixture<Wish>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Wish]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Wish);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
